import { htmlResponse } from './html';

export function renderLegalPage(kind: 'terms' | 'privacy'): Response {
  if (kind === 'terms') {
    return htmlResponse('Terms of Service', `<h1 class="mb-2 text-4xl font-bold">Terms of Service</h1>
      <p class="intro">Last updated: 17 October 2026</p>
      <section class="panel">
        <h2>1. About the service</h2>
        <p>TM Glicko provides Trackmania Cup of the Day (COTD) rating estimates, leaderboards, player profiles, charts, and related Discord bot features. It is an independent community project and is not affiliated with, endorsed by, or sponsored by Ubisoft, Nadeo, Trackmania, or Discord.</p>
      </section>
      <section class="panel">
        <h2>2. Use of the service</h2>
        <p>You may use the service for lawful, personal, and community purposes. Do not disrupt the service, attempt unauthorized access, abuse external APIs, or use it in a way that violates the terms of Trackmania, Discord, or other applicable services.</p>
      </section>
      <section class="panel">
        <h2>3. Ratings and third-party data</h2>
        <p>Ratings, ranks, estimates, and historical results are generated from available competition data and are provided for informational purposes. They may be delayed, incomplete, recalculated, or inaccurate, and are not official Trackmania results. Trackmania and Discord names, services, and data remain subject to their respective owners' terms.</p>
      </section>
      <section class="panel">
        <h2>4. Availability and changes</h2>
        <p>The service is provided without a promise of uninterrupted availability. Features or data may change, be corrected, or be discontinued. Nothing in these terms excludes rights or remedies that cannot legally be excluded.</p>
      </section>
      <section class="panel">
        <h2>5. Governing law and contact</h2>
        <p>These terms are governed by the laws of Spain, without limiting any mandatory consumer protections or jurisdictional rights that apply to you.</p>
        <p>Contact: <strong><a href="mailto:charchiitm@gmail.com">charchiitm@gmail.com</a></strong>.</p>
      </section>`);
  }

  return htmlResponse('Privacy Policy', `<h1 class="mb-2 text-4xl font-bold">Privacy Policy</h1>
    <p class="intro">Last updated: 17 October 2026</p>
    <section class="panel">
      <h2>1. Who is responsible</h2>
      <p>The service operator is the data controller for personal data processed through TM Glicko. The operator's identity and privacy contact must be added before publication: <strong><a href="mailto:charchiitm@gmail.com">charchiitm@gmail.com</a></strong>.</p>
    </section>
    <section class="panel">
      <h2>2. Information processed</h2>
      <ul>
        <li>Trackmania account identifiers and public display names used to find players and show profiles.</li>
        <li>Public COTD placements and rating information, including calculated ratings, ranks, and rating history.</li>
        <li>When you use the Discord bot, Discord account identifiers, usernames, server identifiers, command names, and command inputs needed to respond. Command execution details are also written to application logs for operation and troubleshooting.</li>
        <li>Basic request and diagnostic information processed by the hosting or infrastructure providers, which may include IP address, request path, and technical headers according to their configuration.</li>
      </ul>
      <p>The website does not currently set analytics or advertising cookies. The application does not require a user account to browse public pages.</p>
    </section>
    <section class="panel">
      <h2>3. Purposes and legal bases</h2>
      <p>Information is used to provide player search, leaderboards, rating profiles, COTD results, and Discord command responses; maintain the service; prevent misuse; and diagnose errors. Where applicable, processing is based on providing the requested service, the operator's legitimate interests in maintaining a fair and reliable community tool, or another legal basis required by law.</p>
    </section>
    <section class="panel">
      <h2>4. Sources and sharing</h2>
      <p>Trackmania account names and competition results are obtained from Trackmania/Nadeo services or stored competition records. Information is shared with infrastructure and database providers only as needed to operate the service, and with Trackmania or Discord services when a requested lookup or bot interaction requires it. Those providers may process data under their own privacy terms; their processing and any international transfers depend on the providers and deployment configuration.</p>
    </section>
    <section class="panel">
      <h2>5. Retention and your rights</h2>
      <p>Rating and competition records may be retained while needed to provide historical rankings. Operational logs are retained according to the hosting and deployment configuration; no fixed retention period is currently published. Depending on your circumstances and applicable law, you may have rights to access, correct, delete, restrict, object to, or obtain a copy of your personal data. You may also complain to the Spanish Data Protection Agency (AEPD) or your local supervisory authority.</p>
      <p>To make a privacy request, contact: <strong><a href="mailto:charchiitm@gmail.com">charchiitm@gmail.com</a></strong>. Do not post private information in public issue trackers.</p>
    </section>
    <section class="panel">
      <h2>6. Updates</h2>
      <p>This policy may be updated when the service or its data practices change. The date above indicates the latest revision.</p>
    </section>`);
}
