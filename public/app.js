const list = document.getElementById('list');
const form = document.getElementById('form');
const msg = document.getElementById('msg');
const search = document.getElementById('search');
let items = [];

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

function render() {
  const q = search.value.toLowerCase();
  const shown = items.filter((i) => (i.title + ' ' + i.author).toLowerCase().includes(q));
  list.replaceChildren(
    ...(shown.length ? shown.map(card) : [el('p', { textContent: 'No hay resúmenes.' })])
  );
}

function card(i) {
  const del = el('button', { className: 'del', textContent: 'Eliminar' });
  del.onclick = async () => {
    if (!confirm(`¿Eliminar "${i.title}"?`)) return;
    await fetch(`/api/summaries/${i.id}`, { method: 'DELETE' });
    load();
  };
  const audio = el('audio', { controls: true, preload: 'none', src: `/audio/${i.file}` });
  const meta = [i.author, new Date(i.createdAt).toLocaleDateString()].filter(Boolean).join(' · ');
  return el(
    'div',
    { className: 'item' },
    el('div', { className: 'top' }, el('h3', { textContent: i.title }), del),
    el('div', { className: 'meta', textContent: meta }),
    ...(i.notes ? [el('p', { textContent: i.notes })] : []),
    audio
  );
}

async function load() {
  items = await (await fetch('/api/summaries')).json();
  render();
}

form.onsubmit = async (e) => {
  e.preventDefault();
  msg.textContent = '';
  const res = await fetch('/api/summaries', { method: 'POST', body: new FormData(form) });
  if (!res.ok) {
    msg.textContent = (await res.json()).error;
    return;
  }
  form.reset();
  load();
};

search.oninput = render;
load();
