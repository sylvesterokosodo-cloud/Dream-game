// Test-only stand-in for lucide-react (real package unavailable offline).
type P = { size?: number };
const icon = (name: string) => ({ size = 16 }: P) => (
  <svg width={size} height={size} data-icon={name} aria-hidden="true" />
);
export const Crown = icon('Crown'); export const X = icon('X'); export const Gamepad2 = icon('Gamepad2');
export const Wallet = icon('Wallet'); export const Users = icon('Users'); export const Plus = icon('Plus');
export const Clock3 = icon('Clock3'); export const Gift = icon('Gift'); export const Ticket = icon('Ticket');
export const ArrowUpRight = icon('ArrowUpRight'); export const ShieldCheck = icon('ShieldCheck');
export const Swords = icon('Swords'); export const Trophy = icon('Trophy'); export const Medal = icon('Medal');
export const LayoutDashboard = icon('LayoutDashboard'); export const LogOut = icon('LogOut');
export const LogIn = icon('LogIn'); export const RefreshCw = icon('RefreshCw'); export const Share2 = icon('Share2');
export const Copy = icon('Copy');
