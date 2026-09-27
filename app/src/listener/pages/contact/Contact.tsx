import { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { ContactHero } from "./ContactHero";
import { Switchboard } from "./Switchboard";
import { ContactForm } from "./ContactForm";
import { ContactAside } from "./ContactAside";
import { ContactFaq } from "./ContactFaq";
import { ShareStation } from "./ShareStation";
import { isTopicKey, type TopicKey } from "./topics";
import "./contact.css";

/**
 * /contact - "Talk to the studio", shaped like a radio call-in line.
 * ?topic=<line> opens on that line; picking another line rewrites it in
 * place (no navigation), so the address can be shared straight to a line.
 */
const topicFrom = (search: string): TopicKey => {
  const t = new URLSearchParams(search).get("topic");
  return isTopicKey(t) ? t : "studio";
};

const reducedMotion = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function Contact() {
  const location = useLocation();
  const [topic, setTopic] = useState<TopicKey>(() => topicFrom(location.search));

  // A link to /contact?topic=... while already here (Now Playing, say).
  useEffect(() => {
    setTopic(topicFrom(location.search));
  }, [location.key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const prev = document.title;
    document.title = "Talk to the studio · We Are Radio";
    return () => {
      document.title = prev;
    };
  }, []);

  const pickTopic = useCallback((key: TopicKey) => {
    setTopic(key);
    const url = new URL(window.location.href);
    url.searchParams.set("topic", key);
    // Keep the router's own history entry state, or Back would lose its place.
    window.history.replaceState(window.history.state, "", url);
  }, []);

  const toSwitchboard = useCallback(() => {
    const board = document.getElementById("switchboard");
    board?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
    board?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.focus({ preventScroll: true });
  }, []);

  return (
    <div className="c3p">
      <ContactHero onSendMessage={toSwitchboard} />
      <Switchboard topic={topic} onChange={pickTopic} />
      <div className="c3p-form-row">
        <ContactForm topic={topic} />
        <ContactAside />
      </div>
      <ContactFaq />
      <ShareStation />
    </div>
  );
}
