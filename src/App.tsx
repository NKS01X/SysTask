import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Task {
  id: number;
  title: string;
  done: boolean;
}

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");

  const refresh = async () => setTasks(await invoke<Task[]>("list_tasks"));

  useEffect(() => {
    refresh();
  }, []);

  const add = async () => {
    const t = title.trim();
    if (!t) return;
    await invoke("add_task", { title: t });
    setTitle("");
    refresh();
  };

  const toggle = async (id: number) => {
    await invoke("toggle_task", { id });
    refresh();
  };

  const remove = async (id: number) => {
    await invoke("delete_task", { id });
    refresh();
  };

  return (
    <main className="container">
      <h1>Task Manager</h1>
      <div className="row">
        <input
          value={title}
          placeholder="New task"
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button onClick={add}>Add</button>
      </div>
      <ul>
        {tasks.map((t) => (
          <li key={t.id} className={t.done ? "done" : ""}>
            <label>
              <input
                type="checkbox"
                checked={t.done}
                onChange={() => toggle(t.id)}
              />
              {t.title}
            </label>
            <button onClick={() => remove(t.id)}>Delete</button>
          </li>
        ))}
      </ul>
    </main>
  );
}
