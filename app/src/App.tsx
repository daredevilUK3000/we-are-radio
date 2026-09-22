import { useEffect } from "react";
import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { trackVisit } from "./shared/analytics";
import { Home } from "./listener/pages/Home";
import { Listen } from "./listener/pages/Listen";
import { Albums } from "./listener/pages/Albums";
import { AlbumDetail } from "./listener/pages/AlbumDetail";
import { TrackDetail } from "./listener/pages/TrackDetail";
import { Programmes } from "./listener/pages/Programmes";
import { ProgrammeDetail } from "./listener/pages/ProgrammeDetail";
import { Podcasts } from "./listener/pages/Podcasts";
import { Search } from "./listener/pages/Search";
import { MyRadio } from "./listener/pages/MyRadio";
import { RadioForYou } from "./listener/pages/RadioForYou";
import { TimeCapsule } from "./listener/pages/TimeCapsule";
import { NowPlayingBar } from "./listener/components/NowPlayingBar";
import { ListenerAuthProvider } from "./listener/auth/ListenerAuthContext";
import { FavouritesProvider } from "./listener/favourites/FavouritesContext";
import { ActiveChannelProvider } from "./listener/context/ActiveChannelContext";

import { StudioAuthProvider, useStudioAuth } from "./studio/auth/StudioAuthContext";
import { Login } from "./studio/pages/Login";
import { Dashboard } from "./studio/pages/Dashboard";
import { Tracks } from "./studio/pages/Tracks";
import { UploadTrack } from "./studio/pages/UploadTrack";
import { Channels } from "./studio/pages/Channels";
import { ProgrammesList } from "./studio/pages/ProgrammesList";
import { ProgrammeBuilder } from "./studio/pages/ProgrammeBuilder";
import { AudioAssets } from "./studio/pages/AudioAssets";
import { PodcastImporter } from "./studio/pages/PodcastImporter";
import { PodcastEpisodes } from "./studio/pages/PodcastEpisodes";
import { BulkImport } from "./studio/pages/BulkImport";
import { Drafts } from "./studio/pages/Drafts";
import { RecordLink } from "./studio/pages/RecordLink";
import { ProgrammeTitles } from "./studio/pages/ProgrammeTitles";
import { TimeCapsules } from "./studio/pages/TimeCapsules";
import { UploadAudioAsset } from "./studio/pages/UploadAudioAsset";
import { Guide } from "./studio/pages/Guide";
import { Analytics } from "./studio/pages/Analytics";
import { Albums as StudioAlbums } from "./studio/pages/Albums";
import { AlbumDetail as StudioAlbumDetail } from "./studio/pages/AlbumDetail";
import { PublishWizard } from "./studio/pages/PublishWizard";

function ListenerLayout({ children }: { children: React.ReactNode }) {
  // One "visit" per browser tab session, with where it came from (a YouTube link, a newsletter...).
  useEffect(() => {
    trackVisit();
  }, []);

  return (
    <div className="app-shell listener-shell">
      <header className="top-nav">
        <Link to="/" className="brand listener-logo">
          <img src="/weareradio-logo.webp" alt="We Are Radio" className="listener-logo-img" />
        </Link>
        <nav>
          <NavLink to="/" end>
            Home
          </NavLink>
          <NavLink to="/albums">Albums</NavLink>
          <NavLink to="/programmes">Programmes</NavLink>
          <NavLink to="/podcasts">Podcasts</NavLink>
          <NavLink to="/my-mood">My Mood</NavLink>
          <NavLink to="/search">Search</NavLink>
          <NavLink to="/my-radio">My Radio</NavLink>
        </nav>
      </header>
      <main>{children}</main>
      <NowPlayingBar />
    </div>
  );
}

function StudioLayout({ children }: { children: React.ReactNode }) {
  const { logout } = useStudioAuth();
  // Analytics is a section of its own and uses the whole width of the screen.
  const wide = useLocation().pathname.startsWith("/studio/analytics");
  return (
    <div className="app-shell">
      <header className="top-nav">
        <span className="brand">🎛️ We Are Radio Studio</span>
        <nav className="studio-nav">
          <NavLink to="/studio" end>
            Dashboard
          </NavLink>
          <NavLink to="/studio/analytics">Analytics</NavLink>
          <NavLink to="/studio/publish">Publish Music</NavLink>
          <NavLink to="/studio/bulk-import">Bulk Import</NavLink>
          <NavLink to="/studio/drafts">Drafts</NavLink>
          <NavLink to="/studio/tracks">Music</NavLink>
          <NavLink to="/studio/albums">Albums</NavLink>
          <NavLink to="/studio/audio">Audio</NavLink>
          <NavLink to="/studio/record-link">Record a Link</NavLink>
          <NavLink to="/studio/time-capsules">Time Capsules</NavLink>
          <NavLink to="/studio/channels">Channels</NavLink>
          <NavLink to="/studio/programmes">Programmes</NavLink>
          <NavLink to="/studio/programme-titles">Programme Titles</NavLink>
          <NavLink to="/studio/podcasts">Podcasts</NavLink>
          <NavLink to="/studio/podcast-import">Podcast Import</NavLink>
          <NavLink to="/studio/guide">Guide</NavLink>
        </nav>
        <button className="btn" style={{ marginLeft: "auto" }} onClick={() => logout()}>
          Sign out
        </button>
      </header>
      <main className={wide ? "studio-wide" : undefined}>{children}</main>
    </div>
  );
}

function StudioApp() {
  const { status } = useStudioAuth();

  if (status === "checking") return <p style={{ padding: 20 }}>Loading Studio...</p>;
  if (status === "anonymous") return <Login />;

  return (
    <StudioLayout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="publish" element={<PublishWizard />} />
        <Route path="bulk-import" element={<BulkImport />} />
        <Route path="drafts" element={<Drafts />} />
        <Route path="record-link" element={<RecordLink />} />
        <Route path="time-capsules" element={<TimeCapsules />} />
        <Route path="programme-titles" element={<ProgrammeTitles />} />
        <Route path="tracks" element={<Tracks />} />
        <Route path="tracks/upload" element={<UploadTrack />} />
        <Route path="albums" element={<StudioAlbums />} />
        <Route path="albums/:id" element={<StudioAlbumDetail />} />
        <Route path="audio" element={<AudioAssets />} />
        <Route path="audio/upload" element={<UploadAudioAsset />} />
        <Route path="channels" element={<Channels />} />
        <Route path="podcasts" element={<PodcastEpisodes />} />
        <Route path="podcast-import" element={<PodcastImporter />} />
        <Route path="programmes" element={<ProgrammesList />} />
        <Route path="programmes/:id" element={<ProgrammeBuilder />} />
        <Route path="guide" element={<Guide />} />
      </Routes>
    </StudioLayout>
  );
}

export default function App() {
  return (
    <Routes>
      <Route
        path="/studio/*"
        element={
          <StudioAuthProvider>
            <StudioApp />
          </StudioAuthProvider>
        }
      />
      <Route
        path="/*"
        element={
          <ListenerAuthProvider>
            <FavouritesProvider>
              <ActiveChannelProvider>
                <ListenerLayout>
                  <Routes>
                    <Route path="/" element={<Home />} />
                    <Route path="listen" element={<Listen />} />
                    <Route path="channel/:slug" element={<Listen />} />
                    <Route path="track/:id" element={<TrackDetail />} />
                    <Route path="albums" element={<Albums />} />
                    <Route path="albums/:id" element={<AlbumDetail />} />
                    <Route path="programmes" element={<Programmes />} />
                    <Route path="programmes/:id" element={<ProgrammeDetail />} />
                    <Route path="podcasts" element={<Podcasts />} />
                    <Route path="search" element={<Search />} />
                    <Route path="my-radio" element={<MyRadio />} />
                    <Route path="my-mood" element={<RadioForYou />} />
                    <Route path="time-capsule" element={<TimeCapsule />} />
                  </Routes>
                </ListenerLayout>
              </ActiveChannelProvider>
            </FavouritesProvider>
          </ListenerAuthProvider>
        }
      />
    </Routes>
  );
}
