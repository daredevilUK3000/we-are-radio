/**
 * The official rules for We Are Radio's Top 3 Creator Songs of 2026, shown
 * at /top3/rules. Source: "Official Rules — We Are Radio's Top 3 Creator
 * Songs of 2026.docx" (Files for Claude), with its [square bracket] gaps
 * filled in and two changes agreed with Patrick: one song per entrant, and
 * the confirm-by-email step (section 6).
 *
 * Keep the entry-form declarations (ContestEnter.tsx) and the limits in
 * worker/src/lib/contest.ts in step with this text - the form's licence
 * checkbox points at section 7.
 */
export type RulesBlock =
  | { p: string; lead?: string }
  | { list: string[] }
  | { table: { head: string[]; rows: string[][] } };

export interface RulesSection {
  heading: string;
  blocks: RulesBlock[];
}

export const RULES_LAST_UPDATED: string | null = "24 September 2026";

export const RULES_SECTIONS: RulesSection[] = [
  {
    heading: "1. Organiser",
    blocks: [
      {
        p: "The competition \"We Are Radio's Top 3 Creator Songs of 2026\" (the Competition) is organised by Business Game Changer Magazine, a sole trader (auto-entrepreneur) registered in France, trading as We Are Radio (the Organiser, we, us).",
      },
      {
        list: [
          "Address: 2 Rue de la Roche, Bourganeuf, France",
          "SIRET: 813 208 790 00010",
          "Website: weareradio.app",
          "Contact: info@weareradio.app",
        ],
      },
      { p: "By entering or voting, you accept these rules." },
    ],
  },
  {
    heading: "2. What the competition is",
    blocks: [
      { p: "The Competition recognises three songs by Independent Creators from anywhere in the world as We Are Radio's Top 3 Creator Songs of 2026." },
      {
        p: "Creators submit their songs. Approved songs are played on We Are Radio and listed on weareradio.app. Listeners vote across several rounds, and a judging panel joins the public vote in the final round to decide the Top 3.",
      },
      { p: "Entry is free. No purchase or payment is needed to enter, vote or win." },
    ],
  },
  {
    heading: "3. Key dates",
    blocks: [
      { p: "All times are Paris time (CET/CEST)." },
      {
        table: {
          head: ["Phase", "Opens", "Closes"],
          rows: [
            ["Entries", "1 October 2026, 00:00", "31 March 2027, 23:59"],
            ["Round 1 voting: all approved songs", "1 April 2027", "30 April 2027"],
            ["Round 2 voting: Top 100", "1 May 2027", "31 May 2027"],
            ["Round 3 voting: Top 50", "1 June 2027", "30 June 2027"],
            ["Final round: Top 20, public vote and judging", "1 July 2027", "31 July 2027"],
            ["Winners announced on the Countdown show", "Early September 2027 (date to be announced)", ""],
          ],
        },
      },
      {
        p: "We may extend or shorten a phase if needed. Any change will be posted on weareradio.app at least 7 days before it takes effect, except where urgent (see section 14).",
      },
    ],
  },
  {
    heading: "4. Who can enter",
    blocks: [
      { p: "The Competition is open to Independent Creators anywhere in the world, except where it is prohibited by local law." },
      {
        p: "An Independent Creator is anyone who writes, produces or performs their own music and releases it themselves, without a record label or publishing deal controlling the song entered. Self-release through a distribution service (for example DistroKid, TuneCore or Bandcamp) counts as independent.",
      },
      {
        list: [
          "Entrants must be 18 or over on the day they enter.",
          "Groups and duos may enter. One person must enter on the group's behalf and confirm that every member agrees to these rules.",
          "The Organiser, its family members, judges and sponsor staff directly involved in the Competition may not enter.",
          "Each entrant may enter one song. If that entry is rejected or withdrawn, the entrant may enter a different song instead.",
        ],
      },
    ],
  },
  {
    heading: "5. Eligible songs",
    blocks: [
      {
        p: "A song is eligible if it was created or first released between 1 January 2026 and 31 December 2026. Entries are accepted until 31 March 2027, but songs made in 2027 are not eligible.",
      },
      { p: "Each song must also:" },
      {
        list: [
          "be the entrant's own original work (no cover versions)",
          "contain no samples, loops or other material the entrant does not have the right to use",
          "be no longer than 8 minutes",
          "not be controlled by a record label or music publisher",
          "contain no hateful, defamatory or sexually explicit content, and nothing that incites violence or breaks the law",
        ],
      },
      { p: "Songs may be in any language and any genre. Songs already released on streaming platforms are welcome." },
      {
        lead: "AI tools.",
        p: "Songs made fully or partly with AI tools are allowed. The entrant must hold the rights to use the song commercially under the terms of every tool used. Some AI music services only grant these rights to paid subscribers. The entrant must say on the entry form which AI tools, if any, were used.",
      },
    ],
  },
  {
    heading: "6. How to enter",
    blocks: [
      { p: "Enter only through the entry form on weareradio.app. Entries sent any other way are not accepted." },
      { p: "The form asks for:" },
      {
        list: [
          "The song as an MP3 file, at least 192 kbps, up to 20 MB",
          "Song title",
          "Creator or artist name, as it should appear on air and on the site",
          "Country",
          "Date the song was created or first released",
          "Any AI tools used, and any collecting society membership",
          "The entrant's legal name and email address (not published)",
          "Optional: a short bio (up to 300 characters), a photo, and links to the creator's music or social pages",
        ],
      },
      {
        p: "The entrant must confirm the eligibility and rights statements on the form. After submitting, we email a link to confirm the entry: the entrant must click it within 7 days, or the entry is deleted. An entry counts once it is confirmed, not when it is approved. We then send an email confirming receipt.",
      },
    ],
  },
  {
    heading: "7. Your rights and the licence you give us",
    blocks: [
      { p: "You keep full ownership of your song. Entering does not transfer any copyright to us." },
      { p: "By entering, you give the Organiser a non-exclusive, worldwide, royalty-free licence, until 31 December 2028, to:" },
      {
        list: [
          "stream and broadcast the song on We Are Radio and its channels, including the Creator Spotlight Show and the Countdown show",
          "play the song on the Organiser's podcasts, including Kizzi's Friday Game Changers",
          "host the song on weareradio.app for listening and voting",
          "use short clips of up to 30 seconds, the song title, your creator name, country, bio and photo to promote the Competition and We Are Radio, including on social media",
        ],
      },
      { p: "For the Top 3 winners, this licence continues after 2028 for archive and winner-profile pages." },
      {
        p: "Inclusion in the We Are Radio Creator Songs 2026 compilation is covered by a separate agreement, which we will offer to selected creators before release. No song goes on the compilation without that signed agreement.",
      },
      {
        lead: "Your promises to us.",
        p: "You confirm that the song is your original work, that you own or control all rights needed to grant this licence, and that its use as described will not infringe anyone else's rights. If a claim arises because this is untrue, you agree to be responsible for it.",
      },
      {
        lead: "Collecting societies.",
        p: "If you are a member of a collecting society (such as SACEM, PRS, ASCAP or BMI), tell us on the entry form. Your membership does not stop you entering, but it affects how we license the broadcast.",
      },
    ],
  },
  {
    heading: "8. Review and approval",
    blocks: [
      { p: "Every entry is reviewed by the Organiser before it appears on weareradio.app or on air. We aim to review each entry within 14 days." },
      {
        p: "We may reject an entry that does not meet these rules, has poor audio quality that makes it unfit to broadcast, or that we reasonably believe infringes someone's rights. We will tell you by email if your entry is rejected. Our decision on approval is final.",
      },
      {
        p: "Once approved, your song gets its own page on weareradio.app that you can share straight away. Listeners can play it and sign up to be told when voting opens. Approved songs may also be played on the weekly Creator Spotlight Show from October 2026.",
      },
    ],
  },
  {
    heading: "9. Voting",
    blocks: [
      { p: "Voting is free and takes place only on weareradio.app. Voters must be 15 or over." },
      { lead: "How to vote", p: "" },
      {
        list: [
          "Confirm your email address with the one-time code we send you.",
          "Complete the short security check.",
          "Listen to at least 30 seconds of a song, then tap the vote button.",
        ],
      },
      { lead: "Vote allowance", p: "" },
      {
        list: [
          "Each verified voter has 3 votes per day.",
          "Each of the 3 votes must go to a different song.",
          "The allowance resets at midnight Paris time.",
          "One email address per person. Votes from extra addresses held by the same person will be removed.",
        ],
      },
      { lead: "Rounds", p: "" },
      {
        table: {
          head: ["Round", "Songs in the round", "Who goes through"],
          rows: [
            ["Round 1 (April 2027)", "All approved songs", "The 100 songs with the most votes"],
            ["Round 2 (May 2027)", "Top 100", "The 50 songs with the most votes"],
            ["Round 3 (June 2027)", "Top 50", "The 20 songs with the most votes"],
            ["Final (July 2027)", "Top 20", "Top 3 decided by combined score (section 10)"],
          ],
        },
      },
      { p: "Vote counts reset to zero at the start of each round. If two songs tie for the last place going through, both go through." },
      { p: "Vote totals are shown on the site during Rounds 1 to 3. In the final round they are hidden until the winners are announced." },
    ],
  },
  {
    heading: "10. Judging and final scoring",
    blocks: [
      { p: "The Top 3 are the three songs with the highest combined score in the final round: 50% public vote and 50% judging panel." },
      {
        lead: "The panel.",
        p: "At least 3 judges, named on weareradio.app before the final round opens. Judges must declare any connection to a finalist and will not score that song.",
      },
      {
        lead: "Judges' score.",
        p: "Each judge scores each Top 20 song from 1 to 10 on four criteria: songwriting, production, originality and impact. A song's judges' score is its average total across all judges, converted to a mark out of 100.",
      },
      {
        lead: "Public score.",
        p: "The song with the most final-round votes gets 100. Every other song gets its votes divided by that highest total, times 100.",
      },
      { p: "Combined score = (public score × 0.5) + (judges' score × 0.5)" },
      {
        p: "If two songs tie, the one with the higher judges' score ranks higher. The Top 3 are ranked 1st, 2nd and 3rd. The judges' decision and the final results are final.",
      },
    ],
  },
  {
    heading: "11. Prizes",
    blocks: [
      { p: "Each of the Top 3 receives the Creator's Breakthrough Package:" },
      {
        list: [
          "official recognition as one of We Are Radio's Top 3 Creator Songs of 2026",
          "a featured broadcast of the song on We Are Radio",
          "a digital winner's certificate and trophy",
          "a winner profile on weareradio.app",
          "promotion across We Are Radio's social media channels",
          "an interview opportunity on Kizzi's Friday Game Changers",
          "an offer to include the song in the We Are Radio Creator Songs 2026 compilation (section 7)",
        ],
      },
      {
        p: "Sponsors may add further prizes. Any sponsor prize will be described on weareradio.app, with its value and any conditions, before the final round opens.",
      },
      {
        p: "There is no cash alternative to the prize package. Winners must reply to our winner email within 30 days. If a winner does not reply or cannot be verified as eligible, the next highest-scoring song takes that place.",
      },
      { p: "All Top 20 finalists are named on weareradio.app as 2026 finalists." },
    ],
  },
  {
    heading: "12. Fair play and disqualification",
    blocks: [
      { p: "Entrants are encouraged to share their song page and ask people to vote. That is part of the Competition." },
      { p: "The following are not allowed:" },
      {
        list: [
          "buying votes, or paying or rewarding people to vote",
          "using bots, scripts, click farms or any automated voting",
          "creating or using multiple email addresses to vote more than allowed",
          "offering prizes or incentives in exchange for votes",
          "harassing other entrants or voters",
        ],
      },
      {
        p: "We monitor voting for unusual patterns. We may remove votes we reasonably believe are invalid, and we may disqualify an entrant who breaks these rules or benefits from a breach they knew about. We do not have to disclose how our monitoring works.",
      },
      {
        p: "We may also disqualify an entry at any stage, including after the winners are announced, if it turns out not to meet sections 4, 5 or 7. The next highest-placed song then moves up.",
      },
    ],
  },
  {
    heading: "13. Personal data",
    blocks: [
      { p: "The Organiser is the data controller for personal data collected in the Competition, under the EU General Data Protection Regulation (GDPR)." },
      {
        table: {
          head: ["Who", "What we collect", "Why", "How long we keep it"],
          rows: [
            [
              "Entrants",
              "Legal name, email, country, entry details",
              "To run the Competition, contact you and verify winners",
              "Until 31 December 2028; winners' public profile details longer, as part of the archive",
            ],
            [
              "Voters",
              "Email address (stored in scrambled, hashed form for vote counting), security-check result, approximate location and technical data",
              "To count votes and prevent fraud",
              "Until 31 December 2027",
            ],
            ["Anyone who opts in", "Email address", "To send We Are Radio news", "Until you unsubscribe"],
          ],
        },
      },
      { p: "Your creator name, country, bio, photo and song are published on weareradio.app. Your legal name and email are never published." },
      {
        p: "We do not sell your data. It is stored with our hosting provider, Cloudflare, which may process it outside the EU under approved safeguards.",
      },
      {
        p: "You can ask to see, correct or delete your data, or object to its use, by writing to info@weareradio.app. Deleting an entrant's data withdraws their entry. You can also complain to the CNIL (cnil.fr), the French data protection authority.",
      },
    ],
  },
  {
    heading: "14. General terms",
    blocks: [
      {
        lead: "Changes.",
        p: "We may change these rules, dates or prizes if needed to run the Competition fairly or because of events outside our control. Changes are posted on weareradio.app. Urgent changes, such as those needed to stop fraud, may take effect immediately.",
      },
      {
        lead: "Cancellation.",
        p: "If the Competition cannot run as planned, for example due to technical failure or widespread fraud, we may suspend, restart or cancel it. We will explain why on weareradio.app.",
      },
      {
        lead: "Liability.",
        p: "We are not responsible for entries that are lost, late or corrupted, or for technical problems that stop anyone entering or voting. Nothing in these rules limits liability that cannot be limited by law.",
      },
      { lead: "Sponsors.", p: "Sponsors support the Competition but do not run it. Sponsors are not responsible for the Organiser's decisions." },
      { lead: "Language.", p: "If these rules are translated, the English version applies in case of conflict." },
      {
        lead: "Governing law.",
        p: "These rules are governed by French law. Any dispute will be handled by the courts of Limoges, France, unless the law of your country gives you a right to use your local courts.",
      },
      { lead: "Contact.", p: "Questions about the Competition: info@weareradio.app" },
    ],
  },
];
