type Doc = 'terms' | 'privacy' | 'responsible';

const DRAFT =
  'DRAFT for legal review. This text is a starting template, not legal advice. A Nigerian lawyer must review and approve it (including gaming/lottery licensing) before real-money launch.';

export default function LegalPage({ doc }: { doc: Doc }) {
  return (
    <section className="section legal">
      <a className="link-btn" href="#/">← Back</a>
      <div className="admin-warning" role="note"><span>{DRAFT}</span></div>
      {doc === 'terms' && (
        <>
          <h2>Terms of Use</h2>
          <h3>1. Who can play</h3>
          <p>You must be 18 or older and legally allowed to take part in paid skill competitions where you live. One person may hold one account.</p>
          <h3>2. Coins</h3>
          <p>1 coin costs ₦1 and is bought through Flutterwave. Coins are used only to enter Dream Game tournaments. Coins are not money, cannot be transferred between players, and cannot currently be withdrawn.</p>
          <h3>3. Entry fees and escrow</h3>
          <p>When you join a tournament the entry fee moves from your available coins into escrow. It is refunded in full if you cancel before the tournament starts, if the tournament does not fill within 48 hours of publication, or if the organiser cancels it. After the tournament starts, entries cannot be cancelled.</p>
          <h3>4. Games and results</h3>
          <p>Game moves are checked by our servers. Match results are confirmed by the tournament administrator, who may correct or decide a result, for example after repeated draws or if a player does not show up.</p>
          <h3>5. Prizes</h3>
          <p>The prize is described on each tournament page. Bonus coins are credited automatically to the champion's wallet. Physical prizes are arranged with the winner after the final is approved.</p>
          <h3>6. Fair play</h3>
          <p>No bots, scripts, collusion, multiple accounts or exploiting bugs. We may void results, withhold prizes, refund entries and suspend accounts that break these rules.</p>
          <h3>7. Payments</h3>
          <p>Card and bank details are handled by Flutterwave and never stored by us. If you are charged but coins do not appear, contact [CONTACT EMAIL] with your payment reference.</p>
          <h3>8. Liability and changes</h3>
          <p>The service is provided as is, to the extent permitted by law. We may update these terms; continued use means acceptance. Governing law: [TO BE CONFIRMED BY COUNSEL].</p>
        </>
      )}
      {doc === 'privacy' && (
        <>
          <h2>Privacy Policy (NDPR)</h2>
          <h3>What we collect</h3>
          <p>Your email address, display name, wallet and transaction history, tournament entries and match activity, and payment references. We do not receive or store your card number.</p>
          <h3>Why</h3>
          <p>To run your account, process payments, run tournaments, prevent fraud and meet legal obligations.</p>
          <h3>Who processes data for us</h3>
          <p>Supabase (hosting, authentication, database) and Flutterwave (payments). Other players can see your display name in brackets and winner lists.</p>
          <h3>Your rights</h3>
          <p>You may ask to access, correct or delete your data, subject to financial-record retention obligations. Contact [CONTACT EMAIL].</p>
          <h3>Retention and security</h3>
          <p>Financial records are kept as long as the law requires. Data is protected with access controls and encryption in transit. Data controller: [COMPANY NAME AND ADDRESS].</p>
        </>
      )}
      {doc === 'responsible' && (
        <>
          <h2>Responsible Play</h2>
          <p>Dream Game is for adults (18+). Only spend what you can comfortably afford to lose, and treat entry fees as the price of entertainment, not as income.</p>
          <ul>
            <li>Set yourself a monthly limit before you buy coins.</li>
            <li>Never chase losses and take breaks.</li>
            <li>If play stops being fun, stop and talk to someone you trust.</li>
            <li>To close your account or request a cooling-off period, contact [CONTACT EMAIL].</li>
          </ul>
        </>
      )}
    </section>
  );
}
