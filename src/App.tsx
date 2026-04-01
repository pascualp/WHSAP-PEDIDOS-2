import React, { useState, useEffect, useRef, useMemo } from 'react';
import { CATALOGO_RAW } from './catalogo';

/* === CONFIG === */
const WHATSAPP = "663336160";
const LINK = "https://whsap-pedidos-2.vercel.app/";
const TAB = "\t";

/* === Alias/sinónimos típicos === */
const ALIASES = [
  { from: ["mesclum","mezclun","mezclu","mezcl","mix","mixtura","mezclum"], to: "mezclum" },
  { from: ["rucula","rúcula","rocket"], to: "rucula" },
  { from: ["aisberg","iceberg","ice-berg"], to: "iceberg" },
  { from: ["canonigos","canónigos","canonigo"], to: "canonigo" },
  { from: ["patata","papas","papa"], to: "patata" },
  { from: ["tomate","tomates"], to: "tomate" },
  { from: ["pepino","pepin"], to: "pepino" }
];

const IGNORE_WORDS = new Set([
  "manojo","mallorca","caja","cajas","kilo","kilos","kg","ud","unidad","unidades",
  "bandeja","bandejas","extra","primera","importacion","importación","gr","g","mm",
  "floret","x","por","de","la","el","y","con","sin","del","al"
]);

function parseCatalog(raw: string) {
  const items: { c: string; d: string }[] = [];
  raw.split(/\r?\n/).forEach(line => {
    const t = line.trim();
    if (!t) return;
    const parts = t.split(/\t+/);
    if (parts.length >= 2) {
      const c = parts[0].trim();
      const d = parts.slice(1).join(" ").trim();
      if (c && d) items.push({ c, d });
    }
  });
  return items;
}
const ARTICULOS = parseCatalog(CATALOGO_RAW);

/* Utils */
function normalize(s: string) {
  return String(s)
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/ñ/g, "n")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function applyAliases(q: string) {
  const parts = normalize(q).split(" ").filter(Boolean);
  const out = parts.map(w => {
    for (const rule of ALIASES) {
      if (rule.from.includes(w)) return rule.to;
    }
    return w;
  });
  return out.join(" ");
}

function tokenize(desc: string) { return normalize(desc).split(" ").filter(Boolean); }
function cleanCell(s: string | undefined) { return String(s ?? "").replace(/\t/g, " ").replace(/\r?\n/g, " ").trim(); }
function isDigits(s: string) { return /^[0-9]+$/.test(s); }

function score(descTokens: string[], qTokens: string[]) {
  let s = 0;
  let matchedQTokens = 0;
  
  const validQTokens = qTokens.filter(qt => !IGNORE_WORDS.has(qt));
  if (validQTokens.length === 0) return 0;
  
  for (const qt of validQTokens) {
    let bestMatchForQt = 0;
    for (const dt of descTokens) {
      if (IGNORE_WORDS.has(dt)) continue;
      
      if (dt === qt) {
        bestMatchForQt = Math.max(bestMatchForQt, 60);
      } else if (dt.startsWith(qt)) {
        bestMatchForQt = Math.max(bestMatchForQt, 35);
      } else if (dt.includes(qt)) {
        bestMatchForQt = Math.max(bestMatchForQt, 10);
      } else if (qt.length >= 4 && dt.length >= 4) {
        const dist = levenshtein(qt, dt);
        const maxErr = qt.length <= 5 ? 1 : 2;
        if (dist <= maxErr) {
          bestMatchForQt = Math.max(bestMatchForQt, 25 - dist * 5);
        }
      }
    }
    s += bestMatchForQt;
    if (bestMatchForQt > 0) {
      matchedQTokens++;
    }
  }
  
  if (matchedQTokens < validQTokens.length) {
    return 0; // Require all tokens to match
  }
  
  return s;
}

function levenshtein(a: string, b: string) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function applySmartDefaults(desc: string) {
  let d = desc.toLowerCase().trim();
  if (d === "naranja" || d === "naranjas" || d === "naranjas mesa" || d === "naranja mesa") return "naranja zumo";
  if (d === "calabacin" || d === "calabacines") return "calabacin negro";
  if (d === "tomate" || d === "tomates" || d === "tomates m" || d === "tomate m") return "tomate extra g";
  if (d === "manzana verde" || d === "manzanas verdes") return "manzana golden";
  if (d === "manzana roja" || d === "manzanas rojas") return "manzana royal gala";
  if (d === "manzana" || d === "manzanas") return "manzana golden";
  if (d === "melon" || d === "melones") return "melon piel de sapo";
  if (d === "platano" || d === "platanos") return "platano ban";
  return desc;
}

interface PedidoItem {
  c: string;
  d: string;
  q?: string;
  f?: string;
  o?: string;
}

export default function App() {
  const [pedido, setPedido] = useState<PedidoItem[]>([]);
  const [actual, setActual] = useState<{ c: string; d: string } | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  
  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    } else {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognition) {
        alert("Tu navegador no soporta el reconocimiento de voz.");
        return;
      }
      const recognition = new SpeechRecognition();
      recognition.lang = 'es-ES';
      recognition.continuous = false;
      recognition.interimResults = false;
      
      recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setSearchTerm(transcript);
        setIsListening(false);
      };
      
      recognition.onerror = () => {
        setIsListening(false);
      };
      
      recognition.onend = () => {
        setIsListening(false);
      };
      
      recognitionRef.current = recognition;
      recognition.start();
      setIsListening(true);
    }
  };
  
  const [searchTerm, setSearchTerm] = useState("");
  const [qty, setQty] = useState("");
  const [fmt, setFmt] = useState("");
  const [obs, setObs] = useState("");
  
  const [statusMsg, setStatusMsg] = useState("");
  const [statusType, setStatusType] = useState<"ok" | "warn" | "bad" | "">("");
  const [toastMsg, setToastMsg] = useState("");
  
  const [qtyError, setQtyError] = useState(false);
  const [fmtError, setFmtError] = useState(false);
  
  const [bulkText, setBulkText] = useState("");
  const [activeTab, setActiveTab] = useState<'search' | 'bulk'>('search');

  const searchInputRef = useRef<HTMLInputElement>(null);
  const qtyInputRef = useRef<HTMLInputElement>(null);
  const fmtSelectRef = useRef<HTMLSelectElement>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(""), 2000);
  };

  const isComplete = () => !!(cleanCell(qty) && cleanCell(fmt));

  const showNeedComplete = () => {
    setStatusMsg("⚠️ Completa Cantidad y Formato antes de seguir.");
    setStatusType("bad");
    setQtyError(!cleanCell(qty));
    setFmtError(!cleanCell(fmt));
    alert("Completa Cantidad y Formato antes de seguir.");
    if (!cleanCell(qty)) qtyInputRef.current?.focus();
    else fmtSelectRef.current?.focus();
  };

  const blockIfIncomplete = () => {
    if (actual && !isComplete()) {
      showNeedComplete();
      return true;
    }
    return false;
  };

  const saveNow = () => {
    if (!actual || !isComplete()) return false;

    const q = cleanCell(qty);
    const f = cleanCell(fmt);
    const o = cleanCell(obs);

    setPedido(prev => {
      let newPedido = [...prev];
      let lineIndex = newPedido.findIndex(p => p.c === actual.c);
      if (lineIndex >= 0) {
        newPedido[lineIndex] = { ...newPedido[lineIndex], q, f, o };
      } else {
        newPedido.push({ c: actual.c, d: actual.d, q, f, o });
      }
      return newPedido.sort((a, b) => a.d.localeCompare(b.d, "es"));
    });

    setStatusMsg("✅ Guardado automáticamente");
    setStatusType("ok");

    closeEditor();
    setSearchTerm("");
    searchInputRef.current?.focus();
    return true;
  };

  const closeEditor = () => {
    setActual(null);
    setQty("");
    setFmt("");
    setObs("");
    setQtyError(false);
    setFmtError(false);
    setIsDirty(false);
  };

  const openEditor = (item: { c: string; d: string }) => {
    setActual(item);
    const existing = pedido.find(p => p.c === item.c);
    setQty(existing ? (existing.q || "") : "");
    setFmt(existing ? (existing.f || "") : "");
    setObs(existing ? (existing.o || "") : "");
    setQtyError(false);
    setFmtError(false);
    setIsDirty(false);
    setTimeout(() => qtyInputRef.current?.focus(), 0);
  };

  // Autosave effect
  useEffect(() => {
    if (!actual || !isDirty) return;
    const timer = setTimeout(() => {
      if (isComplete()) {
        saveNow();
      } else {
        setStatusMsg("Completa Cantidad y Formato para guardar.");
        setStatusType("warn");
      }
    }, 700);
    return () => clearTimeout(timer);
  }, [qty, fmt, obs, actual, isDirty]);

  const handleSearchFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    if (blockIfIncomplete()) {
      e.preventDefault();
      searchInputRef.current?.blur();
    }
  };

  const searchResults = useMemo(() => {
    const raw = searchTerm.trim();
    if (!raw || raw.length < 3) return [];

    const qn = normalize(applyAliases(raw));
    const qTokens = qn.split(" ").filter(Boolean);

    let matches = ARTICULOS.map(a => {
      const code = normalize(a.c);
      const dt = tokenize(a.d);
      let s = 0;

      if (isDigits(qn)) {
        if (code.startsWith(qn)) s = 999;
      } else {
        s = score(dt, qTokens);
      }
      return { ...a, s };
    }).filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s || a.d.localeCompare(b.d, "es"))
      .slice(0, 25);

    return matches;
  }, [searchTerm]);

  const buildMessage = () => {
    const lines = [];
    lines.push(["Cantidad", "Formato", "Código", "Descripción", "Observaciones"].join(TAB));
    pedido.forEach(p => {
      lines.push([cleanCell(p.q), cleanCell(p.f), cleanCell(p.c), cleanCell(p.d), cleanCell(p.o || "")].join(TAB));
    });
    lines.push("");
    lines.push(LINK);
    return lines.join("\n");
  };

  const sendWhatsApp = () => {
    if (actual) {
      if (isComplete()) saveNow();
      else { showNeedComplete(); return; }
    }
    if (!pedido.length) {
      setStatusMsg("Pedido vacío");
      setStatusType("warn");
      showToast("Pedido vacío");
      return;
    }
    
    // WhatsApp App URL scheme for mobile/desktop app
    const message = encodeURIComponent(buildMessage());
    const url = `whatsapp://send?phone=${WHATSAPP}&text=${message}`;
    
    // Fallback to web if app isn't opened
    window.location.href = url;
    setTimeout(() => {
        window.location.href = `https://wa.me/${WHATSAPP}?text=${message}`;
    }, 1000);
  };

  const addCustomArticle = (description: string) => {
    const newArticle = {
      c: "PENDIENTE-" + Date.now(), // Código temporal único
      d: description
    };
    openEditor(newArticle);
    setSearchTerm("");
    showToast(`📝 Completa los datos para: ${description}`);
  };

  const clearPedido = () => {
    if (actual) {
      if (isComplete()) saveNow();
      else { showNeedComplete(); return; }
    }
    setPedido([]);
    closeEditor();
    setStatusMsg("Pedido limpiado");
    setStatusType("warn");
    showToast("Pedido limpiado");
    setSearchTerm("");
    searchInputRef.current?.focus();
  };

  const removeArticle = (code: string) => {
    if (actual) {
      if (isComplete()) saveNow();
      else { showNeedComplete(); return; }
    }
    setPedido(prev => prev.filter(p => p.c !== code));
    setStatusMsg("Artículo eliminado");
    setStatusType("warn");
    showToast("🗑 Artículo eliminado");
  };

  const processBulkText = () => {
    if (!bulkText.trim()) return;

    const lines = bulkText.split('\n');
    const newItems: PedidoItem[] = [];
    let notFound: string[] = [];

    lines.forEach(line => {
      const t = line.trim();
      if (!t) return;

      let q = "1";
      let f = "ud";
      let rawDesc = t;

      // 1. Quantity at the beginning: "5 kg de tomates"
      let match = t.match(/^(\d+(?:[.,]\d+)?)\s*(kg|kilos?|cajas?|cj|und?|unidades?|manojos?|mj)?\s*(?:de\s+)?(.*)$/i);
      
      if (!match) {
        // 2. Quantity at the end: "tomates 5 kg"
        match = t.match(/^(.*?)\s*(?:de\s+)?(\d+(?:[.,]\d+)?)\s*(kg|kilos?|cajas?|cj|und?|unidades?|manojos?|mj)?$/i);
        if (match) {
           match = [match[0], match[2], match[3], match[1]];
        }
      }

      if (match) {
        q = match[1].replace(',', '.');
        const rawFmt = (match[2] || "").toLowerCase();
        if (rawFmt.startsWith('k')) f = 'kg';
        else if (rawFmt.startsWith('c')) f = 'caja';
        else if (rawFmt.startsWith('u') || rawFmt.startsWith('m')) f = 'ud';
        
        rawDesc = match[3];
      }

      rawDesc = applySmartDefaults(rawDesc);

      const qn = normalize(applyAliases(rawDesc));
      const qTokens = qn.split(" ").filter(Boolean);

      let matches = ARTICULOS.map(a => {
        const dt = tokenize(a.d);
        return { ...a, s: score(dt, qTokens) };
      }).filter(x => x.s > 0).sort((a, b) => b.s - a.s || a.d.localeCompare(b.d, "es"));

      if (matches.length > 0 && matches[0].s > 5) {
        const bestMatch = matches[0];
        console.log(`Input: "${t}" -> Best Match: "${bestMatch.d}" (Score: ${bestMatch.s})`);
        newItems.push({
          c: bestMatch.c,
          d: bestMatch.d,
          q: q,
          f: f,
          o: ""
        });
      } else {
        console.log(`Input: "${t}" -> No good match found, adding as custom.`);
        newItems.push({
          c: "PENDIENTE-" + Date.now() + "-" + Math.random(),
          d: rawDesc,
          q: q,
          f: f,
          o: "Pendiente de asignar código"
        });
      }
    });

    if (newItems.length > 0) {
      setPedido(prev => {
        let combined = [...prev];
        newItems.forEach(ni => {
          // If it's a custom item, always add as new to avoid merging with other custom items
          if (ni.c.startsWith("PENDIENTE-")) {
            combined.push(ni);
          } else {
            const existingIndex = combined.findIndex(p => p.c === ni.c);
            if (existingIndex >= 0) {
              const existing = combined[existingIndex];
              combined[existingIndex] = {
                ...existing,
                q: String(parseFloat(existing.q || "0") + parseFloat(ni.q || "0")),
                f: ni.f || existing.f
              };
            } else {
              combined.push(ni);
            }
          }
        });
        return combined.sort((a, b) => a.d.localeCompare(b.d, "es"));
      });
      showToast(`✅ ${newItems.length} artículos procesados`);
      setBulkText("");
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      <header className="max-w-4xl mx-auto p-4 flex justify-center">
        <img 
          src="https://i.postimg.cc/WbpmvhRj/LOGO.png" 
          alt="BonAny Logo" 
          className="h-16 w-auto"
        />
      </header>

      <main className="max-w-4xl mx-auto p-4 space-y-4">
        
        {/* TABS DE NAVEGACIÓN */}
        <div className="flex p-1.5 bg-slate-200/70 rounded-xl">
          <button
            onClick={() => setActiveTab('search')}
            className="flex-1 py-2.5 px-4 rounded-lg text-sm font-semibold transition-all duration-200 bg-white text-blue-700 shadow-sm"
          >
            🔍 Buscar artículos
          </button>
        </div>

        <div className={activeTab === 'search' ? 'block space-y-4' : 'hidden'}>
          <section className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
            <div className="relative flex items-center">
              <input
                ref={searchInputRef}
                value={searchTerm}
                onChange={e => {
                  if (blockIfIncomplete()) return;
                  setSearchTerm(e.target.value);
                }}
                onPaste={e => {
                  const pasted = e.clipboardData.getData('text');
                  if (pasted.includes('\n')) {
                    e.preventDefault();
                    setBulkText(pasted);
                    setActiveTab('bulk');
                    showToast("Modo lista activado automáticamente");
                  }
                }}
                onFocus={handleSearchFocus}
                placeholder="Buscar por código o nombre (min 3 letras)..."
                className="w-full p-3 pr-12 text-base border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={toggleListening}
                className={`absolute right-3 p-2 rounded-full transition-colors ${isListening ? 'bg-red-500 text-white animate-pulse' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                title="Escribir por audio"
              >
                🎤
              </button>
            </div>
          
          {searchResults.length > 0 && !actual && (
            <div className="mt-2 border border-slate-200 rounded-xl overflow-hidden bg-white max-h-80 overflow-y-auto">
              {searchResults.map(a => (
                <div
                  key={a.c}
                  onClick={() => {
                    if (blockIfIncomplete()) return;
                    openEditor(a);
                    setSearchTerm("");
                  }}
                  className="p-3 border-b border-slate-100 last:border-0 cursor-pointer hover:bg-slate-50"
                >
                  <div className="text-blue-700 text-sm font-mono">{a.c}</div>
                  <div className="text-sm">{a.d}</div>
                </div>
              ))}
            </div>
          )}

          {searchResults.length === 0 && searchTerm.length >= 3 && !actual && (
            <div className="mt-2 p-4 border border-slate-200 rounded-xl bg-white text-center">
              <p className="text-sm text-slate-500 mb-3">No se encontraron artículos.</p>
              <button
                onClick={() => addCustomArticle(searchTerm)}
                className="w-full p-3 text-sm font-bold rounded-xl bg-amber-500 text-white hover:bg-amber-600 transition-colors shadow-sm"
              >
                Añadir "{searchTerm}" manualmente
              </button>
            </div>
          )}

          {actual && (
            <div className="mt-4 space-y-3">
              <p className="mb-2"><strong className="font-mono text-blue-700">{actual.c}</strong> — <span>{actual.d}</span></p>

              <input
                ref={qtyInputRef}
                value={qty}
                onChange={e => {
                  setQty(e.target.value.replace(/[^0-9.,]/g, "").replace(",", "."));
                  setQtyError(false);
                  setIsDirty(true);
                }}
                placeholder="Cantidad"
                type="number"
                step="any"
                inputMode="decimal"
                className={`w-full p-3 text-base border ${qtyError ? 'border-red-600 ring-2 ring-red-100' : 'border-slate-200'} rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500`}
              />
              <select
                ref={fmtSelectRef}
                value={fmt}
                onChange={e => {
                  setFmt(e.target.value);
                  setFmtError(false);
                  setIsDirty(true);
                }}
                className={`w-full p-3 text-base border ${fmtError ? 'border-red-600 ring-2 ring-red-100' : 'border-slate-200'} rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white`}
              >
                <option value="">Formato</option>
                <option value="kg">kg</option>
                <option value="caja">caja</option>
                <option value="ud">ud</option>
              </select>
              <textarea
                value={obs}
                onChange={e => {
                  setObs(e.target.value);
                  setIsDirty(true);
                }}
                placeholder="Observaciones (opcional)"
                className="w-full p-3 text-base border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[120px] md:min-h-[72px]"
              />

              <div className="flex flex-col gap-2 mt-2">
                <button
                  onClick={() => {
                    closeEditor();
                    setStatusMsg("Edición cancelada");
                    setStatusType("warn");
                    searchInputRef.current?.focus();
                  }}
                  className="p-3 text-base font-semibold rounded-xl border border-red-600 bg-red-50 text-red-700 hover:bg-red-100"
                >
                  Cancelar edición
                </button>
              </div>
            </div>
          )}

          {statusMsg && (
            <div className={`mt-3 text-sm ${statusType === 'ok' ? 'text-green-600' : statusType === 'warn' ? 'text-amber-600' : 'text-red-600'}`}>
              {statusMsg}
            </div>
          )}
        </section>
        </div>

        <section className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
          <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
            <div className="max-h-[52vh] overflow-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-slate-50 text-slate-500 text-xs sm:text-sm sticky top-0 z-10">
                  <tr>
                    <th className="p-2 sm:p-3 border-b border-slate-200 w-[70px] sm:w-[90px] font-medium">Cant.</th>
                    <th className="p-2 sm:p-3 border-b border-slate-200 w-[70px] sm:w-[90px] font-medium">Fmt.</th>
                    <th className="p-2 sm:p-3 border-b border-slate-200 font-medium">Desc.</th>
                    <th className="p-2 sm:p-3 border-b border-slate-200 w-[100px] sm:w-[260px] font-medium">Obs.</th>
                    <th className="p-2 sm:p-3 border-b border-slate-200 w-[80px] sm:w-[120px] font-medium">Acción</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  {pedido.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-4 text-sm text-slate-500 text-center">No hay artículos añadidos todavía.</td>
                    </tr>
                  ) : (
                    pedido.map(p => (
                      <tr key={p.c} className="border-b border-slate-100 last:border-0">
                        <td className="p-2 sm:p-3 font-mono text-xs sm:text-sm align-top">{cleanCell(p.q)}</td>
                        <td className="p-2 sm:p-3 text-xs sm:text-sm align-top">{cleanCell(p.f)}</td>
                        <td className="p-2 sm:p-3 text-xs sm:text-sm align-top">{cleanCell(p.d)}</td>
                        <td className="p-2 sm:p-3 text-xs sm:text-sm align-top">{cleanCell(p.o)}</td>
                        <td className="p-2 sm:p-3 align-top">
                          <div className="flex flex-col gap-1">
                            <button
                              onClick={() => openEditor(p)}
                              className="px-2 py-1 text-xs font-bold rounded-lg border border-blue-600 bg-blue-50 text-blue-700 hover:bg-blue-100"
                            >
                              ✏️
                            </button>
                            <button
                              onClick={() => removeArticle(p.c)}
                              className="px-2 py-1 text-xs font-bold rounded-lg border border-red-600 bg-red-50 text-red-700 hover:bg-red-100"
                            >
                              🗑
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex flex-col gap-2 mt-4">
            <button
              onClick={sendWhatsApp}
              className="p-3 text-base font-semibold rounded-xl border border-green-600 bg-green-50 text-green-700 hover:bg-green-100"
            >
              Enviar por WhatsApp
            </button>
            <button
              onClick={clearPedido}
              className="p-3 text-base font-semibold rounded-xl border border-red-600 bg-red-50 text-red-700 hover:bg-red-100"
            >
              Limpiar pedido
            </button>
          </div>
        </section>
      </main>

      {toastMsg && (
        <div className="fixed left-1/2 bottom-5 -translate-x-1/2 bg-slate-900/95 text-white px-4 py-2.5 rounded-full text-sm shadow-lg z-50 max-w-[calc(100vw-24px)] text-center whitespace-nowrap overflow-hidden text-ellipsis animate-in fade-in slide-in-from-bottom-2">
          {toastMsg}
        </div>
      )}
    </div>
  );
}
