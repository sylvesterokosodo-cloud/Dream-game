"""Static cross-reference audit: frontend/Edge code vs SQL migrations. Run: python3 tests/crossref_audit.py"""
import glob, re, sys

sql = "\n".join(open(f).read() for f in sorted(glob.glob("supabase/migrations/*.sql")))
problems = []

# ---- schema ----
tables = {}
for m in re.finditer(r"create table (?:if not exists )?public\.(\w+) \((.*?)\n\);", sql, re.S):
    cols = set()
    for line in m.group(2).split("\n"):
        mm = re.match(r"\s{2}(\w+)\s+(?!check|primary|unique|constraint|references)\w", line)
        if mm and mm.group(1) not in ("constraint", "unique", "check", "primary"):
            cols.add(mm.group(1))
    tables[m.group(1)] = cols
for m in re.finditer(r"alter table public\.(\w+)\s+(add column.*?);", sql, re.S):
    for c in re.findall(r"add column (?:if not exists )?(\w+)", m.group(2)):
        tables[m.group(1)].add(c)

funcs = {}
for m in re.finditer(r"create (?:or replace )?function public\.(\w+)\((.*?)\)\s*returns", sql, re.S):
    params = [re.match(r"\s*(\w+)", p).group(1) for p in re.split(r",\s*(?=\w+\s+[a-z])", m.group(2)) if p.strip()]
    funcs[m.group(1)] = params
dropped = set(re.findall(r"drop function if exists public\.(\w+)", sql))

# ---- usage in code ----
files = glob.glob("src/**/*.ts*", recursive=True) + glob.glob("supabase/functions/*/index.ts") + glob.glob("supabase/functions/_shared/*.ts")
used_tables, used_rpcs = {}, {}
for f in files:
    t = open(f).read()
    for m in re.finditer(r"\.from\(\s*'(dg_\w+)'\s*\)(.*?)(?:;|\n\s*\n)", t, re.S):
        used_tables.setdefault(m.group(1), []).append((f, m.group(2)))
    for m in re.finditer(r"""rpc\(\s*['"](\w+)['"]\s*(?:,\s*\{([^}]*)\})?""", t):
        used_rpcs.setdefault(m.group(1), []).append((f, m.group(2) or ""))
    for m in re.finditer(r"""rpc<[^>]*>\(\s*['"](\w+)['"]\s*,\s*\{([^}]*)\}""", t):
        used_rpcs.setdefault(m.group(1), []).append((f, m.group(2)))

for tname, uses in used_tables.items():
    if tname not in tables:
        problems.append(f"TABLE {tname} used but not created"); continue
    for f, chain in uses:
        for sel in re.findall(r"\.select\(\s*(?:\n\s*)?((?:'[^']*'\s*\+?\s*)+)", chain):
            cols = "".join(re.findall(r"'([^']*)'", sel))
            for c in cols.split(","):
                c = c.strip()
                if c and c != "*" and c not in tables[tname]:
                    problems.append(f"COLUMN {tname}.{c} selected in {f} but not in schema")
        for c in re.findall(r"\.(?:eq|neq|in)\(\s*'(\w+)'", chain):
            if c not in tables[tname]:
                problems.append(f"COLUMN {tname}.{c} filtered in {f} but not in schema")
# COLUMNS constant in tournaments.ts
tt = open("src/lib/tournaments.ts").read()
m = re.search(r"const COLUMNS =\s*((?:\s*'[^']*'\s*\+?)+)", tt)
for c in "".join(re.findall(r"'([^']*)'", m.group(1))).split(","):
    if c not in tables["dg_tournaments"]: problems.append(f"COLUMN dg_tournaments.{c} in COLUMNS but not in schema")
ma = open("src/lib/api.ts").read()
m = re.search(r"const MATCH_COLS =\s*'([^']*)'", ma)
for c in m.group(1).split(","):
    if c not in tables["dg_matches"]: problems.append(f"COLUMN dg_matches.{c} in MATCH_COLS but not in schema")

for name, uses in used_rpcs.items():
    if name not in funcs: problems.append(f"RPC {name} called but not defined"); continue
    for f, args in uses:
        keys = re.findall(r"(\bp_\w+)\s*:", args) or re.findall(r"(\bp_\w+)\s*[,}]?", args)
        for k in set(keys):
            if k not in funcs[name]:
                problems.append(f"RPC {name}: argument {k} (in {f}) not in SQL params {funcs[name]}")

# ---- SQL internal references ----
for ref in set(re.findall(r"(?<!references )public\.(dg_\w+)\(", sql)):
    if ref not in funcs and ref not in dropped: problems.append(f"SQL references undefined function public.{ref}()")
for ref in set(re.findall(r"(?:from|join|into|update|table)\s+public\.(dg_\w+)", sql)):
    if ref not in tables: problems.append(f"SQL references undefined table public.{ref}")

# ---- security hygiene ----
for fn in funcs:
    if not re.search(rf"revoke all on function public\.{fn}\(", sql):
        problems.append(f"SECURITY: public.{fn} has no explicit REVOKE (default grants may expose it)")
rls_list = re.search(r"foreach t in array array\[(.*?)\]", sql, re.S).group(1)
for t in tables:
    if t not in rls_list and f"alter table public.{t} enable row level security" not in sql:
        problems.append(f"SECURITY: table {t} has no RLS enable/revoke")
for fn in funcs:
    body = re.search(rf"function public\.{fn}\(.*?\$\$", sql, re.S)
    defn = sql[sql.index(f"function public.{fn}("):][:900]
    if "security definer" in defn and "set search_path" not in defn:
        problems.append(f"SECURITY: {fn} is SECURITY DEFINER without a fixed search_path")


# ---- GRANT/REVOKE signatures must match function definitions (a mismatch aborts the migration) ----
defs = {}
for m in re.finditer(r"create (?:or replace )?function public\.(\w+)\((.*?)\)\s*returns", sql, re.S):
    types = []
    for p in re.split(r",\s*(?=\w+\s+[a-z])", m.group(2)):
        p = re.sub(r"\s+default\s+.*$", "", p.strip(), flags=re.S)
        if p:
            types.append(" ".join(p.split()[1:]).replace("integer", "int4").replace("bigint", "int8"))
    defs.setdefault(m.group(1), []).append(types)
for m in re.finditer(r"(?:grant|revoke)\s+(?:execute|all)\s+on function public\.(\w+)\(([^)]*)\)", sql):
    types = [t.strip().replace("integer", "int4").replace("bigint", "int8") for t in m.group(2).split(",") if t.strip()]
    if m.group(1) in defs and types not in defs[m.group(1)] :
        problems.append(f"SIGNATURE: grant/revoke on {m.group(1)}({m.group(2)}) matches no definition {defs[m.group(1)]}")

# ---- security assertions over the SQL text (STATIC evidence, not an executed test) ----
# 1. Client roles never receive write privileges on tables (except column-level rename on profiles).
for m in re.finditer(r"grant\s+([^;]*?)\s+on\s+(?:table\s+)?public\.(\w+)\s+to\s+([^;]*);", sql, re.I):
    privs, tbl, roles = m.group(1).lower(), m.group(2), m.group(3).lower()
    if ("anon" in roles or "authenticated" in roles) and privs.strip() != "select":
        if not (tbl == "dg_profiles" and privs.strip() == "update (display_name)"):
            problems.append(f"SECURITY: client role granted '{privs}' on {tbl}")
# 2. No INSERT/UPDATE/DELETE RLS policies except renaming own profile.
for m in re.finditer(r"create policy (\w+) on public\.(\w+)\s+for\s+(insert|update|delete|all)", sql, re.I):
    if m.group(1) != "dg_profiles_rename_self":
        problems.append(f"SECURITY: write policy {m.group(1)} on {m.group(2)}")
# 3. Every dg_admin_* function checks dg_is_admin() before doing anything.
for fn in [f for f in funcs if f.startswith("dg_admin_")]:
    body = sql[sql.rindex(f"create or replace function public.{fn}("):]
    body = body[: body.index("end $$;")]
    first_raise = body.index("Administrator access required") if "Administrator access required" in body else -1
    if "public.dg_is_admin()" not in body or first_raise < 0:
        problems.append(f"SECURITY: {fn} lacks an admin check")
    elif re.search(r"\b(insert into|update public|delete from)\b", body[:first_raise], re.I):
        problems.append(f"SECURITY: {fn} writes before the admin check")
# 4. Service-only functions are never granted to client roles; client RPCs are never granted to anon.
service_only = {"dg_credit_purchase", "dg_system_save_game", "dg__apply_ledger", "dg__refund_all",
                "dg__build_round", "dg__start_tournament", "dg__complete_tournament", "dg__advance_tournament"}
for m in re.finditer(r"grant\s+execute\s+on\s+function\s+public\.(\w+)\([^)]*\)\s+to\s+([^;]*);", sql, re.I):
    fn, roles = m.group(1), m.group(2).lower()
    if fn in service_only and ("authenticated" in roles or "anon" in roles):
        problems.append(f"SECURITY: service-only {fn} granted to {roles}")
    if fn != "dg_is_admin" and "anon" in roles:
        problems.append(f"SECURITY: {fn} executable by anon")
# 5. Only one admin email is hard-coded, and only in the admin table check / sync / seed.
emails = {e.rstrip(".") for e in re.findall(r"[\w.]+@[\w.]+", sql)}
if emails != {"sylvesterokosodo@gmail.com"}:
    problems.append(f"SECURITY: unexpected email literals in SQL: {emails}")

# ---- lexical lint per migration ----
for f in sorted(glob.glob("supabase/migrations/*.sql")):
    t = open(f).read()
    if t.count("$$") % 2: problems.append(f"LINT: unbalanced $$ in {f}")
    code = re.sub(r"--[^\n]*", "", t)
    code = re.sub(r"'(?:[^']|'')*'", "''", code)
    if code.count("(") != code.count(")"): problems.append(f"LINT: unbalanced parentheses in {f}")
    for kw in ("create function", "create table"):
        pass

print(f"tables: {len(tables)}  functions: {len(funcs)}  rpc names used by code: {len(used_rpcs)}  tables used by code: {len(used_tables)}")
print("PROBLEMS:" if problems else "No cross-reference problems found.")
for p in problems: print(" -", p)
sys.exit(1 if problems else 0)
