import { Link } from "react-router-dom";
import { LegalPage } from "./LegalPage";

/** /legal - legal notice (mentions légales), English then French. Copy approved by Patrick. */
export function Legal() {
  return (
    <LegalPage eyebrow="We Are Radio" title="Legal notice" docTitle="Legal notice · We Are Radio">
      <h2>Publisher</h2>
      <p>weareradio.app is published by We Are Radio. Email: info@weareradio.app.</p>

      <h2>Hosting</h2>
      <p>
        Cloudflare, Inc., 101 Townsend Street, San Francisco, CA 94107, United States. <a href="https://www.cloudflare.com">www.cloudflare.com</a>
      </p>

      <h2>Intellectual property</h2>
      <p>
        The station's name, logo, programmes, recordings and site content belong to We Are Radio unless stated otherwise. Songs entered in the Top
        3 competition remain the property of their creators (see the competition rules).
      </p>

      <h2>Contact</h2>
      <p>
        For any question about this site, use the <Link to="/contact">contact page</Link> or write to info@weareradio.app.
      </p>

      <hr className="lgp-divider" />

      <section lang="fr" aria-labelledby="lgp-fr">
        <h2 id="lgp-fr">Mentions légales</h2>

        <h3>Éditeur</h3>
        <p>Le site weareradio.app est édité par We Are Radio. E-mail : info@weareradio.app.</p>

        <h3>Hébergeur</h3>
        <p>
          Cloudflare, Inc., 101 Townsend Street, San Francisco, CA 94107, États-Unis. <a href="https://www.cloudflare.com">www.cloudflare.com</a>
        </p>

        <h3>Propriété intellectuelle</h3>
        <p>
          Le nom, le logo, les émissions, les enregistrements et le contenu du site appartiennent à We Are Radio, sauf mention contraire. Les
          chansons inscrites au concours Top 3 restent la propriété de leurs créateurs (voir le règlement du concours).
        </p>

        <h3>Contact</h3>
        <p>
          Pour toute question concernant ce site, utilisez la <Link to="/contact">page de contact</Link> ou écrivez à info@weareradio.app.
        </p>
      </section>
    </LegalPage>
  );
}
