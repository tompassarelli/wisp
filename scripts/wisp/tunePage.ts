


export const TUNE_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Wisp tune</title>
<style>
  :root { color-scheme: light dark; --line: #8884; --muted: #888; --accent: #3a7bd5; --bad: #d33; }
  body { font: 14px/1.4 system-ui, sans-serif; margin: 0 auto; max-width: 980px; padding: 12px 16px 48px; }
  h1 { font-size: 18px; margin: 4px 0 2px; }
  h2 { font-size: 15px; margin: 18px 0 4px; border-bottom: 1px solid var(--line); padding-bottom: 2px; }
  #status { color: var(--muted); min-height: 1.4em; margin-bottom: 6px; }
  #status.bad { color: var(--bad); }
  .row { display: grid; grid-template-columns: minmax(150px, 1.4fr) minmax(120px, 2fr) 9em auto; gap: 8px; align-items: center; padding: 3px 0; }
  .row input[type=range] { width: 100%; }
  .row input[type=number] { width: 100%; box-sizing: border-box; }
  .name small { display: block; color: var(--muted); font-size: 12px; }
  .changed .name { color: var(--accent); }
  .buttons { display: flex; gap: 4px; }
  button { font: inherit; padding: 1px 8px; }
  pre { background: #8881; padding: 8px; overflow-x: auto; font-size: 12px; }
  @media (max-width: 640px) { .row { grid-template-columns: 1fr 7em; } .row input[type=range] { grid-column: 1 / -1; grid-row: 2; } }
</style>
</head>
<body>
<h1>Tune the running match</h1>
<div id="status">Loading values…</div>
<div id="rows"></div>
<pre id="diff" hidden></pre>
<script>
const rows = document.getElementById("rows");
const status = document.getElementById("status");
const diffView = document.getElementById("diff");
const say = (text, bad) => { status.textContent = text; status.className = bad ? "bad" : ""; };
const show = (diff) => { diffView.hidden = diff === ""; diffView.textContent = diff; };
async function call(path, body) {
  const response = await fetch(path, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}
const seconds = (applied) => applied.version == null ? "already running" : "running in every client " + (applied.milliseconds / 1000).toFixed(3) + " s after the change";
function describe(t) {
  const source = t.source == null ? "missing from the source" : t.source === t.value ? "the source's value" : "source " + t.source;
  return "running " + t.value + ", " + source + (t.original === t.value ? "" : ", started at " + t.original);
}
function render(list) {
  rows.textContent = "";
  let group;
  for (const t of list) {
    if (t.group !== group) {
      group = t.group;
      if (group !== "") rows.appendChild(Object.assign(document.createElement("h2"), { textContent: group }));
    }
    const row = document.createElement("div");
    row.className = "row" + (t.value !== t.original || t.source !== t.value ? " changed" : "");
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = t.name;
    const note = document.createElement("small");
    note.textContent = describe(t);
    name.appendChild(note);
    const slider = Object.assign(document.createElement("input"), { type: "range", min: t.min, max: t.max, step: t.step, value: t.value });
    const field = Object.assign(document.createElement("input"), { type: "number", min: t.min, max: t.max, step: t.kind === "int" ? 1 : "any", value: t.value });
    slider.oninput = () => { field.value = slider.value; };
    const apply = async (value) => {
      say("Applying " + t.name + " = " + value + "…");
      try {
        const applied = await call("/apply", { name: t.name, value: Number(value) });
        say(t.name + " = " + value + ": " + seconds(applied));
      } catch (error) { say(error.message, true); }
      await refresh();
    };
    slider.onchange = () => apply(slider.value);
    field.onchange = () => apply(field.value);
    const keep = Object.assign(document.createElement("button"), { textContent: "Keep", title: "Write the running value into the source" });
    keep.onclick = async () => {
      try {
        const { diff } = await call("/keep", { name: t.name });
        show(diff);
        say(diff === "" ? "The source already has " + t.name + " = " + t.value : "Kept " + t.name + " = " + t.value + " in the source");
      } catch (error) { say(error.message, true); }
      await refresh();
    };
    const reset = Object.assign(document.createElement("button"), { textContent: "Reset", title: "Put back the starting value in the match and the source" });
    reset.onclick = async () => {
      try {
        const { diff, applied } = await call("/reset", { name: t.name });
        show(diff);
        say("Reset " + t.name + " to " + t.original + ": " + seconds(applied));
      } catch (error) { say(error.message, true); }
      await refresh();
    };
    const buttons = document.createElement("div");
    buttons.className = "buttons";
    buttons.append(keep, reset);
    row.append(name, slider, field, buttons);
    rows.appendChild(row);
  }
}
async function refresh() {
  try { render(await call("/tunables")); } catch (error) { say(error.message, true); }
}
refresh().then(() => { if (status.textContent === "Loading values…") say("Change a value to run it in every client."); });
</script>
</body>
</html>
`;
