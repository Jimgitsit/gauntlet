import { createContext, useContext, useEffect, useState } from "react";
import { api, post, type User } from "./api";
import { href, usePath } from "./router";
import { ChangeDetail } from "./pages/ChangeDetail";
import { Changes } from "./pages/Changes";
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
  const section = path.split("/")[1] || "changes";
  let page: React.ReactNode;
  const changeMatch = /^\/changes\/(\d+)$/.exec(path);
  if (changeMatch) {
    page = <ChangeDetail id={Number(changeMatch[1])} />;
  } else if (section === "repos") {
    page = <Repos />;
  } else if (section === "wiki") {
    page = <Wiki />;
  } else {
    page = <Changes />;
  }
  const nav = [
    { to: "/", label: "Changes", key: "changes" },
    { to: "/repos", label: "Repositories", key: "repos" },
    { to: "/wiki", label: "Team wiki", key: "wiki" },
  ];
  return (
    <div className="shell">
      <nav className="rail">
        <a className="brand" href={href("/")}>
          <Mark />
          Gauntlet
        </a>
        {nav.map((n) => (
          <a key={n.key} className={`nav${section === n.key || (n.key === "changes" && section === "") ? " active" : ""}`} href={href(n.to)}>
            {n.label}
          </a>
        ))}
        <div className="spacer" />
        <div className="who">
          <strong>{user.org.name}</strong>
          {user.email}
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
        </div>
      </nav>
      <main className="main">{page}</main>
    </div>
  );
}

function Mark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="5" fill="var(--accent)" />
      <path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="var(--accent-ink)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
