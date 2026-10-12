/*
 * MSuedy Barber — configuração e lógica do frontend.
 * Preencha SUPABASE_URL e SUPABASE_ANON_KEY (publishable key) abaixo.
 * Nunca coloque a service_role key neste arquivo.
 */
const SUPABASE_URL = "COLE_AQUI_SUA_SUPABASE_URL";
const SUPABASE_ANON_KEY = "COLE_AQUI_SUA_SUPABASE_PUBLIC_KEY";

const sbConfigured = SUPABASE_URL.startsWith("https://")
  && !SUPABASE_URL.includes("COLE_AQUI")
  && SUPABASE_ANON_KEY.length > 20
  && !SUPABASE_ANON_KEY.includes("COLE_AQUI");
const sb = sbConfigured ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
const $ = (id) => document.getElementById(id);
const pad2 = n => String(n).padStart(2, "0");
const localDate = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
const formatDate = s => new Date(`${s}T12:00:00`).toLocaleDateString("pt-BR", {weekday:"short",day:"2-digit",month:"2-digit",year:"numeric"});
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function notice(id, message, type="error") {
  const el = $(id); if (!el) return;
  el.textContent = message; el.className = `notice show ${type}`;
}
function clearNotice(id) { const el=$(id); if(el){el.textContent="";el.className="notice";} }
function ensureConfigured(id) {
  if (!sb) { notice(id, "Configure a URL e a public key do Supabase no início do arquivo app.js antes de usar o sistema."); return false; }
  return true;
}
document.addEventListener("DOMContentLoaded", () => {
  if ($("year")) $("year").textContent = new Date().getFullYear();
  if ($("bookingForm")) initBookingPage();
  if ($("loginForm")) initAdminPage();
});

function getTimes(dateString) {
  if (!dateString) return [];
  const day = new Date(`${dateString}T12:00:00`).getDay();
  if (day === 0) return [];
  if (day === 6) return Array.from({length:9}, (_,i)=>`${pad2(i+8)}:00`); // 08:00–16:00
  return Array.from({length:6}, (_,i)=>`${pad2(i+18)}:00`); // 18:00–23:00
}
let selectedTime = null;
async function initBookingPage() {
  const dateEl=$("data"), slots=$("slots"), submit=$("submitBtn");
  dateEl.min=localDate();
  dateEl.addEventListener("change", renderPublicSlots);
  $("bookingForm").addEventListener("submit", submitBooking);
  await renderPublicSlots();
  async function renderPublicSlots() {
    selectedTime=null; submit.disabled=true; clearNotice("notice");
    const date=dateEl.value;
    if (!date) { slots.innerHTML='<p class="muted small">Selecione uma data para consultar os horários.</p>'; return; }
    const day=new Date(`${date}T12:00:00`).getDay();
    if(day===0){slots.innerHTML='<p class="muted small">A barbearia não atende aos domingos. Escolha outro dia.</p>';return;}
    if(date<localDate()){slots.innerHTML='<p class="muted small">Escolha uma data futura.</p>';return;}
    if(!ensureConfigured("notice")){slots.innerHTML='<p class="muted small">Configure o Supabase em app.js para carregar os horários reais.</p>';return;}
    slots.innerHTML='<p class="muted small">Consultando disponibilidade...</p>';
    const {data:booked,error}=await sb.rpc("get_booked_slots",{p_data:date});
    if(error){slots.innerHTML='<p class="muted small">Não foi possível consultar os horários. Confira a configuração SQL do Supabase.</p>';notice("notice",`Erro ao consultar horários: ${error.message}`);return;}
    const busy=new Set((booked||[]).map(x=>x.horario));
    const now=new Date(), today=date===localDate(), times=getTimes(date);
    slots.innerHTML="";
    times.forEach(time=>{
      const past=today && time<=`${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
      const occupied=busy.has(time);
      const btn=document.createElement("button");btn.type="button";btn.className="slot"+(occupied||past?" unavailable":"");
      btn.textContent=time;btn.disabled=occupied||past;
      if(occupied)btn.title="Horário já reservado";else if(past)btn.title="Horário já passou";
      btn.addEventListener("click",()=>{selectedTime=time;slots.querySelectorAll(".slot").forEach(x=>x.classList.remove("selected"));btn.classList.add("selected");submit.disabled=false;clearNotice("notice");});
      slots.appendChild(btn);
    });
    if(!times.length)slots.innerHTML='<p class="muted small">Nenhum horário disponível.</p>';
  }
  async function submitBooking(e) {
    e.preventDefault();clearNotice("notice");
    if(!ensureConfigured("notice"))return;
    if(!selectedTime){notice("notice","Selecione um horário disponível.");return;}
    const date=dateEl.value;
    const payload={p_nome:$("nome").value.trim(),p_telefone:$("telefone").value.trim(),p_servico:$("servico").value,p_data:date,p_horario:selectedTime};
    if(!payload.p_nome||!payload.p_telefone){notice("notice","Preencha nome e WhatsApp.");return;}
    submit.disabled=true;submit.textContent="Confirmando...";
    const {data,error}=await sb.rpc("book_appointment",payload);
    submit.textContent="Confirmar agendamento";
    if(error){notice("notice",error.message.includes("SLOT_TAKEN")?"Esse horário acabou de ser reservado. Escolha outro.":`Não foi possível confirmar: ${error.message}`);await renderPublicSlots();return;}
    notice("notice",`Agendamento confirmado para ${formatDate(date)} às ${selectedTime}.`,"success");
    $("bookingForm").reset();selectedTime=null;submit.disabled=true;await renderPublicSlots();
  }
}

async function initAdminPage() {
  $("refreshBtn").addEventListener("click",loadBookings);
  $("todayBtn").addEventListener("click",()=>{$("filterDate").value=localDate();loadBookings();});
  $("allBtn").addEventListener("click",()=>{$("filterDate").value="";loadBookings();});
  $("filterDate").addEventListener("change",loadBookings);
  if(!ensureConfigured("dashboardNotice"))return;
  await loadBookings();

  async function loadBookings(){
    clearNotice("dashboardNotice");
    let q=sb.from("agendamentos").select("id,nome,telefone,servico,data,horario,status,criado_em").order("data",{ascending:true}).order("horario",{ascending:true}).limit(500);
    const filter=$("filterDate").value;
    if(filter)q=q.eq("data",filter);
    else q=q.gte("data",localDate()).lte("data",localDate(new Date(Date.now()+30*86400000)));
    const {data,error}=await q;
    if(error){notice("dashboardNotice",`Erro ao carregar agendamentos: ${error.message}`);return;}
    const rows=data||[];$("countBookings").textContent=rows.length;
    const now=new Date();
    const next=rows.find(r=>r.status==="confirmado"&&(r.data>localDate()||(r.data===localDate()&&r.horario>=`${pad2(now.getHours())}:${pad2(now.getMinutes())}`)));
    $("nextBooking").textContent=next?`${formatDate(next.data)} ${next.horario}`:"—";
    const wrap=$("bookingTableWrap");
    if(!rows.length){wrap.innerHTML='<p class="muted">Nenhum agendamento encontrado para este filtro.</p>';return;}
    wrap.innerHTML=`<table><thead><tr><th>Data / hora</th><th>Cliente</th><th>Serviço</th><th>Status</th><th>Ação</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(formatDate(r.data))}<br><b>${esc(r.horario)}</b></td><td><b>${esc(r.nome)}</b><br><span class="muted small">${esc(r.telefone)}</span></td><td>${esc(r.servico)}</td><td><span class="status ${r.status==="cancelado"?"status-cancelled":"status-confirmed"}">${esc(r.status)}</span></td><td>${r.status==="confirmado"?`<button class="cancel-btn" data-cancel="${esc(r.id)}">Cancelar</button>`:"—"}</td></tr>`).join("")}</tbody></table>`;
    wrap.querySelectorAll("[data-cancel]").forEach(btn=>btn.addEventListener("click",async()=>{
      if(!confirm("Deseja cancelar este agendamento?"))return;
      const {error}=await sb.from("agendamentos").update({status:"cancelado"}).eq("id",btn.dataset.cancel);
      if(error){notice("dashboardNotice",`Erro ao cancelar: ${error.message}`);return;}
      notice("dashboardNotice","Agendamento cancelado.","success");await loadBookings();
    }));
  }
}
