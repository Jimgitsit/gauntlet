import { createContext, useContext, useEffect, useState } from "react";
import { api, post, type User } from "./api";
import { PLATES, TILE } from "./mark";
import { href, usePath } from "./router";
import { ChangeDetail } from "./pages/ChangeDetail";
import { ChangeList } from "./pages/ChangeList";
import { Dashboard } from "./pages/Dashboard";
import { Login } from "./pages/Login";
import { Repos } from "./pages/Repos";
import { Wiki } from "./pages/Wiki";

const UserContext = createContext<User | null>(null);

export function useUser(): User {
  const u = useContext(UserContext);
  if (!u) {
    throw new Error("no user");
  }
  return u;
}

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => {
    api<{ user: User | null }>("/auth/me")
      .then((r) => setUser(r.user))
      .catch(() => setUser(null));
  }, []);
  if (user === undefined) {
    return null;
  }
  if (!user) {
    return <Login onSignedIn={setUser} />;
  }
  return (
    <UserContext.Provider value={user}>
      <Shell onSignedOut={() => setUser(null)} />
    </UserContext.Provider>
  );
}

function Shell({ onSignedOut }: { onSignedOut: () => void }) {
  const path = usePath();
  const user = useUser();
  const section = path.split("/")[1] || "dashboard";
  let page: React.ReactNode;
  const changeMatch = /^\/changes\/(\d+)$/.exec(path);
  if (changeMatch) {
    page = <ChangeDetail id={Number(changeMatch[1])} />;
  } else if (section === "changes") {
    page = <ChangeList />;
  } else if (section === "repos") {
    page = <Repos />;
  } else if (section === "wiki") {
    page = <Wiki />;
  } else {
    page = <Dashboard />;
  }
  const nav = [
    { to: "/", label: "Dashboard", key: "dashboard" },
    { to: "/changes", label: "Changes", key: "changes" },
    { to: "/repos", label: "Repositories", key: "repos" },
    { to: "/wiki", label: "Cognition", key: "wiki" },
  ];
  return (
    <div className="shell">
      <nav className="rail">
        <a className="brand" href={href("/")}>
          <Mark />
          Gauntlet
        </a>
        {nav.map((n) => (
          <a key={n.key} className={`nav${section === n.key ? " active" : ""}`} href={href(n.to)}>
            {n.label}
          </a>
        ))}
        <div className="spacer" />
        <div className="who">
          <strong>{user.org.name}</strong>
          {user.email}
          {user.demo ? (
            <div style={{ marginTop: 6 }}>Public demo on seeded data. Click around, resolve findings, edit the wiki.</div>
          ) : (
            <div style={{ marginTop: 6 }}>
              <button
                className="btn small"
                onClick={() => {
                  post("/auth/logout").then(onSignedOut);
                }}
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </nav>
      <main className="main">{page}</main>
    </div>
  );
}

// Same drawing as the tab and home-screen icon; the plates live in mark.ts.
function Mark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="0" y="0" width="24" height="24" rx="5" fill={TILE} />
      {PLATES.map((p, i) => (
        <rect key={i} x={p.x} y={p.y} width={p.w} height={p.h} rx={p.r} fill={p.fill} transform={p.rot ? `rotate(${p.rot} ${p.x + p.w / 2} ${p.y + p.h / 2})` : undefined} />
      ))}
    </svg>
  );
}
