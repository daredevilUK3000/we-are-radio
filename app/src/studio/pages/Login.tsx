import { useState } from "react";
import { useStudioAuth } from "../auth/StudioAuthContext";

export function Login() {
  const { login } = useStudioAuth();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(password);
    } catch {
      setError("Incorrect password");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: 320, margin: "80px auto" }}>
      <h1>Kizzi Radio Studio</h1>
      <form onSubmit={submit}>
        <div className="form-row">
          <label>Studio password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        </div>
        {error && <p style={{ color: "var(--accent)" }}>{error}</p>}
        <button className="btn primary" disabled={submitting} type="submit">
          {submitting ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </div>
  );
}
