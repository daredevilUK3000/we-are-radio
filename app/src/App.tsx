import { NavLink, Route, Routes } from "react-router-dom";
import { Home } from "./listener/pages/Home";
import { Listen } from "./listener/pages/Listen";
import { Albums } from "./listener/pages/Albums";
import { AlbumDetail } from "./listener/pages/AlbumDetail";
import { Programmes } from "./listener/pages/Programmes";
import { ProgrammeDetail } from "./listener/pages/ProgrammeDetail";
import { Search } from "./listener/pages/Search";
import { NowPlayingBar } from "./listener/components/NowPlayingBar";

import { StudioAuthProvider, useStudioAuth } from "./studio/auth/StudioAuthContext";
import { Login } from "./studio/pages/Login";
import { Dashboard } from "./studio/pages/Dashboard";
import { Tracks } from "./studio/pages/Tracks";
import { UploadTrack } from "./studio/pages/UploadTrack";
import { Channels } from "./studio/pages/Channels";
import { ProgrammesList } from "./studio/pages/ProgrammesList";
import { ProgrammeBuilder } from "./studio/pages/ProgrammeBuilder";

function ListenerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <header className="top-nav">
        <span className="brand">🎙️ Kizzi Radio</span>
        <nav>
          <NavLink to="/" end>
            Home
          </NavLink>
          <NavLink to="/albums">Albums</NavLink>
          <NavLink to="/programmes">Programmes</NavLink>
          <NavLink to="/search">Search</NavLink>
        </nav>
      </header>
      <main>{children}</main>
      <NowPlayingBar />
    </div>
  );
}

function StudioLayout({ children }: { children: React.ReactNode }) {
  const { logout } = useStudioAuth();
  return (
    <div className="app-shell">
      <header className="top-nav">
        <span className="brand">🎛️ Kizzi Radio Studio</span>
        <nav>
          <NavLink to="/studio" end>
            Dashboard
          </NavLink>
          <NavLink to="/studio/tracks">Music</NavLink>
          <NavLink to="/studio/channels">Channels</NavLink>
          <NavLink to="/studio/programmes">Programmes</NavLink>
        </nav>
        <button className="btn" style={{ marginLeft: "auto" }} onClick={() => logout()}>
          Sign out
        </button>
      </header>
      <main>{children}</main>
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
        <Route path="tracks" element={<Tracks />} />
        <Route path="tracks/upload" element={<UploadTrack />} />
        <Route path="channels" element={<Channels />} />
        <Route path="programmes" element={<ProgrammesList />} />
        <Route path="programmes/:id" element={<ProgrammeBuilder />} />
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
          <ListenerLayout>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="listen" element={<Listen />} />
              <Route path="albums" element={<Albums />} />
              <Route path="albums/:id" element={<AlbumDetail />} />
              <Route path="programmes" element={<Programmes />} />
              <Route path="programmes/:id" element={<ProgrammeDetail />} />
              <Route path="search" element={<Search />} />
            </Routes>
          </ListenerLayout>
        }
      />
    </Routes>
  );
}
