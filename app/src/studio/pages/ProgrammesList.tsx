import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { studioApi } from "../../api/client";

export function ProgrammesList() {
  const navigate = useNavigate();
  const [programmes, setProgrammes] = useState<any[]>([]);
  const [channels, setChannels] = useState<any[]>([]);
  const [title, setTitle] = useState("");
  const [channelId, setChannelId] = useState("");

  useEffect(() => {
    studioApi.programmes().then((r) => setProgrammes(r.programmes));
    studioApi.channels().then((r) => {
      setChannels(r.channels);
      if (r.channels[0]) setChannelId(r.channels[0].id);
    });
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !channelId) return;
    const { id } = await studioApi.createProgramme({ title, channel_id: channelId });
    navigate(`/studio/programmes/${id}`);
  };

  return (
    <div>
      <h1>Programmes</h1>

      <form onSubmit={create} className="card" style={{ marginBottom: 24, display: "flex", gap: 10, alignItems: "flex-end" }}>
        <div className="form-row" style={{ flex: 1, marginBottom: 0 }}>
          <label>New programme title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="form-row" style={{ marginBottom: 0 }}>
          <label>Channel</label>
          <select value={channelId} onChange={(e) => setChannelId(e.target.value)}>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <button className="btn primary" type="submit">
          Create
        </button>
      </form>

      <table>
        <thead>
          <tr>
            <th>Title</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {programmes.map((p) => (
            <tr key={p.id}>
              <td>{p.title}</td>
              <td>
                <span className="badge">{p.status}</span>
              </td>
              <td>
                <Link className="btn" to={`/studio/programmes/${p.id}`}>
                  Open
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
