import { Link } from "react-router-dom";
import { LegalPage } from "./LegalPage";

/** /privacy - the site's privacy notice. Copy approved by Patrick; publish as written. */
export function Privacy() {
  return (
    <LegalPage eyebrow="We Are Radio" title="Privacy notice" docTitle="Privacy notice · We Are Radio">
      <h2>Who we are</h2>
      <p>
        This site is run by We Are Radio. Contact: info@weareradio.app, or the <Link to="/contact">contact page</Link>.
      </p>

      <h2>Contact messages</h2>
      <p>
        When you use the contact page we keep your name, email address, message, the topic you chose, any extra details you add, whether you
        agreed to have your message read on air, and basic technical details (the page you came from and your browser). We use them only to read
        and reply to your message and, if you agreed, to read it on air with your first name. We keep messages for 24 months, then delete them.
      </p>

      <h2>Likes</h2>
      <p>
        If you like a song, we set a small cookie with a random code so we remember your like. It doesn't identify you, and we never show anyone
        else what you liked.
      </p>

      <h2>Listening statistics</h2>
      <p>We count plays and visits in aggregate to see what people enjoy. These counts don't identify you.</p>

      <h2>Offline listening</h2>
      <p>Music you save for offline listening is stored on your own device, not with us.</p>

      <h2>The Top 3 competition</h2>
      <p>
        Entries, votes and reminder emails are covered by <Link to="/top3/rules#privacy">section 13 of the competition rules</Link>.
      </p>

      <h2>Who processes your data</h2>
      <p>
        Our hosting provider, Cloudflare, and our email provider, Resend. Some processing may take place outside the EU under approved safeguards.
      </p>

      <h2>Your rights</h2>
      <p>
        You can ask to see, correct or delete your data, or object to its use, by writing to info@weareradio.app. You can also complain to the
        CNIL (<a href="https://www.cnil.fr">cnil.fr</a>).
      </p>
    </LegalPage>
  );
}
