#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ap-Ab — Backend LOCAL de pruebas (sin Supabase, sin Netlify, sin costos).

Sirve la UI y responde el cotizador con la MISMA rúbrica (config.json).
Lee config.json en cada cálculo, así que puedes editar los precios y ver
el cambio recotizando (sin reiniciar). Pensado para probar y ajustar precios.

Uso:   python3 backend_local.py [puerto] [open]
       (el lanzador del Escritorio lo arranca con:  4321 open)

Límite 2/semana: desactivado por defecto para que pruebes libremente.
Para probar el límite real, arranca con:  APAB_ENFORCE_LIMIT=1 python3 backend_local.py
"""
import os, sys, json, re, http.server, socketserver, functools, hashlib, secrets, webbrowser, urllib.request
from datetime import datetime, timezone, date

DIR = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(DIR, ".local_data.json")
SEVEN_DAYS = 7 * 24 * 60 * 60
FREE_PER_WEEK = 2
ENFORCE = os.environ.get("APAB_ENFORCE_LIMIT", "0") == "1"


def load_cfg():
    with open(os.path.join(DIR, "config.json"), "r", encoding="utf-8") as f:
        return json.load(f)


def load_data():
    try:
        with open(DATA, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"users": {}, "sessions": {}}


def save_data(d):
    with open(DATA, "w", encoding="utf-8") as f:
        json.dump(d, f, indent=2)


def hpw(p):
    return hashlib.sha256(("apab-local::" + p).encode("utf-8")).hexdigest()


def supa_cfg():
    """Lee SUPABASE_URL + anon key de assets/supabase-config.js (si están puestos)."""
    try:
        txt = open(os.path.join(DIR, "assets", "supabase-config.js"), "r", encoding="utf-8").read()
    except Exception:
        return None
    mu = re.search(r'SUPABASE_URL:\s*"([^"]+)"', txt)
    mk = re.search(r'SUPABASE_ANON_KEY:\s*"([^"]+)"', txt)
    if not mu or not mk:
        return None
    url, key = mu.group(1), mk.group(1)
    if "TU-PROYECTO" in url or "TU_ANON" in key:
        return None
    return (url.rstrip("/"), key)


def validate_supabase(sc, token):
    """Valida un JWT de Supabase contra /auth/v1/user. Devuelve el user id o None."""
    if not sc or not token:
        return None
    url, key = sc
    req = urllib.request.Request(
        url + "/auth/v1/user",
        headers={"apikey": key, "Authorization": "Bearer " + token},
    )
    try:
        with urllib.request.urlopen(req, timeout=6) as r:
            obj = json.loads(r.read().decode("utf-8"))
            return obj.get("id")
    except Exception:
        return None


def esp_system(is_iterate):
    base = (
        "Eres Arquitecto de Software Senior y Disenador UI de Ap-Ab. Devuelve EXCLUSIVAMENTE un objeto JSON "
        "valido (sin markdown, sin texto fuera del JSON) con las claves: "
        "nombre_proyecto (string corto), "
        "dra (Markdown siguiendo el contrato MASTER DRA, en este orden: '# MASTER DRA: [Nombre]', "
        "'## 1. VISION ARQUITECTONICA', '## 2. REGLAS ESTRICTAS DE SISTEMA' [Frontend: HTML5/CSS3/Vanilla JS sin frameworks; "
        "Backend: Python puro o FastAPI; UI/UX: glassmorphism estricto, colores oscuros, sin emojis], "
        "'## 3. ESPECIFICACIONES DE FRONTEND (UI/UX)', '## 4. ESPECIFICACIONES DE BACKEND Y LOGICA', '## 5. ESTRUCTURA DE DATOS'), "
        "mockup_html (un documento HTML completo y autocontenido, glassmorphism, fondo oscuro #0a0b08, acentos #ff5b2e y #ffab4d, "
        "sin emojis, sin imagenes externas, sin frameworks ni CDNs, que muestre la pantalla principal del producto), "
        "params (tipo in [landing, web_o_app_sencilla, app_con_backend, app_compleja, producto_con_ia], "
        "complejidad in [baja, media, alta], addons subset de [autenticacion, pagos, integraciones, ia_llm, diseno_personalizado, multiplataforma], "
        "urgencia bool, plataformas subset de [web, ios, android, escritorio]). "
    )
    return base + ("Refina el plan existente segun el cambio del usuario." if is_iterate else "Planea desde la descripcion del usuario.")


def deepseek_call(messages):
    key = os.environ.get("DEEPSEEK_API_KEY")
    if not key:
        return None
    model = os.environ.get("DEEPSEEK_MODEL", "deepseek-chat")
    body = json.dumps({
        "model": model, "messages": messages, "max_tokens": 8000,
        "temperature": 0.4, "response_format": {"type": "json_object"},
    }).encode("utf-8")
    req = urllib.request.Request(
        "https://api.deepseek.com/chat/completions", data=body,
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=90) as r:
        d = json.loads(r.read().decode("utf-8"))
    text = (d.get("choices", [{}])[0].get("message", {}).get("content", "") or "").strip()
    text = re.sub(r"^```(?:json)?", "", text)
    text = re.sub(r"```$", "", text)
    return json.loads(text.strip())


# ---------- pricing (igual que netlify/functions/lib/pricing.js) ----------
def r1000(n):
    return round(n / 1000) * 1000


def tier(b, rg):
    return {"base": r1000(b), "min": r1000(b * rg["min"]), "max": r1000(b * rg["max"])}


def resolve_params(cfg, p):
    tipos = list(cfg["tarifa_mercado_por_tipo"].keys())
    comps = list(cfg["factor_complejidad"].keys())
    addons_ok = list(cfg["addons_mercado"].keys())
    tipo = p.get("tipo") if p.get("tipo") in tipos else "web_o_app_sencilla"
    comp = p.get("complejidad") if p.get("complejidad") in comps else "media"
    addons = [a for a in (p.get("addons") or []) if a in addons_ok]
    addons = list(dict.fromkeys(addons))
    plats = (p.get("plataformas") or [])[:8]
    return {"tipo": tipo, "complejidad": comp, "addons": addons,
            "plataformas": plats, "urgencia": bool(p.get("urgencia"))}


def compute_quote(cfg, params, today_str):
    rg = cfg.get("rango", {"min": 1, "max": 1})
    r = resolve_params(cfg, params)
    base = cfg["tarifa_mercado_por_tipo"][r["tipo"]] * cfg["factor_complejidad"][r["complejidad"]]
    base += sum(cfg["addons_mercado"][a] for a in r["addons"])
    if r["urgencia"]:
        base *= cfg.get("urgencia_factor", 1)
    apab = base * cfg["factor_apab"]
    active = str(today_str) <= str(cfg["vigencia_lanzamiento"])
    lanz = apab * cfg["descuento_lanzamiento"] if active else apab
    ant = lanz * cfg["anticipo"]
    sal = lanz * cfg["saldo"]
    ah = base - lanz
    pct = round((1 - lanz / base) * 100) if base else 0
    return {
        "moneda": cfg.get("moneda"),
        "nota_referencia": cfg.get("nota_referencia"),
        "vigencia_lanzamiento": cfg.get("vigencia_lanzamiento"),
        "launch_active": active,
        "params": r,
        "mercado": tier(base, rg), "apab": tier(apab, rg), "lanzamiento": tier(lanz, rg),
        "anticipo": tier(ant, rg), "saldo": tier(sal, rg), "ahorro": tier(ah, rg),
        "ahorro_pct": pct,
        "notas": ["Precio estimado, sujeto a revisión.", cfg.get("nota_referencia")],
    }


# ---------- HTTP handler ----------
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _json(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        ln = int(self.headers.get("Content-Length", "0") or 0)
        raw = self.rfile.read(ln) if ln else b"{}"
        try:
            data = json.loads(raw or b"{}")
        except Exception:
            return self._json(400, {"error": "bad_json"})
        path = self.path.split("?")[0]
        if path == "/api/login":
            return self.h_login(data)
        if path == "/.netlify/functions/cotizar":
            return self.h_cotizar(data)
        if path == "/.netlify/functions/cotizar-especifica":
            return self.h_especifica(data)
        if path == "/.netlify/functions/solicitud-final":
            return self.h_solicitud(data)
        return self._json(404, {"error": "not_found"})

    # Resuelve el usuario por sesión local o por JWT de Supabase. -> (user_key, email)
    def _resolve(self, d, token):
        uk = d["sessions"].get(token or "")
        if uk and uk in d["users"]:
            return uk, uk  # en local la clave ES el correo
        sc = supa_cfg()
        if sc and token:
            try:
                req = urllib.request.Request(sc[0] + "/auth/v1/user",
                                             headers={"apikey": sc[1], "Authorization": "Bearer " + token})
                with urllib.request.urlopen(req, timeout=6) as r:
                    obj = json.loads(r.read().decode("utf-8"))
                if obj.get("id"):
                    return "supa:" + obj["id"], obj.get("email")
            except Exception:
                pass
        return None, None

    def h_especifica(self, data):
        if not os.environ.get("DEEPSEEK_API_KEY"):
            return self._json(503, {"error": "especifica_unavailable",
                                    "detail": "Pon DEEPSEEK_API_KEY en el .env local para probar la especifica."})
        d = load_data()
        uk, email = self._resolve(d, data.get("token") or "")
        if not uk:
            return self._json(401, {"error": "invalid_session"})
        try:
            cfg = load_cfg()
        except Exception:
            return self._json(500, {"error": "config"})
        action = "iterate" if data.get("action") == "iterate" else "start"
        text = (data.get("text") or "").strip()[:4000]
        if not text:
            return self._json(400, {"error": "empty_text"})
        sessions = d.setdefault("esp_sessions", {})

        if action == "iterate":
            sid = data.get("session_id")
            s = sessions.get(sid)
            if not s or s.get("user") != uk:
                return self._json(404, {"error": "session_not_found"})
            if s.get("iters", 0) >= 12:
                return self._json(429, {"error": "max_iters"})
            try:
                out = deepseek_call([
                    {"role": "system", "content": esp_system(True)},
                    {"role": "user", "content": "PLAN ACTUAL (DRA):\n" + (s.get("dra") or "") +
                        "\n\nPARAMS: " + json.dumps(s.get("params") or {}) +
                        "\n\nCAMBIO SOLICITADO:\n" + text + "\n\nDevuelve el JSON COMPLETO actualizado."},
                ])
            except Exception:
                return self._json(502, {"error": "ai_error"})
            out["params"] = resolve_params(cfg, out.get("params"))
            s["dra"] = out.get("dra"); s["params"] = out["params"]; s["nombre"] = out.get("nombre_proyecto")
            s["iters"] = s.get("iters", 0) + 1
            save_data(d)
            q = compute_quote(cfg, out["params"], date.today().isoformat())
            return self._json(200, {"ok": True, "mockup_html": out.get("mockup_html", ""), "quote": q,
                                    "nombre_proyecto": out.get("nombre_proyecto", ""), "iter_count": s["iters"],
                                    "iters_left": 12 - s["iters"]})

        # start (en local no aplicamos el limite; es para probar)
        try:
            out = deepseek_call([
                {"role": "system", "content": esp_system(False)},
                {"role": "user", "content": "Descripcion del proyecto:\n" + text},
            ])
        except Exception:
            return self._json(502, {"error": "ai_error"})
        out["params"] = resolve_params(cfg, out.get("params"))
        sid = secrets.token_hex(12)
        sessions[sid] = {"user": uk, "email": email, "nombre": out.get("nombre_proyecto"),
                         "dra": out.get("dra"), "params": out["params"], "iters": 0}
        save_data(d)
        q = compute_quote(cfg, out["params"], date.today().isoformat())
        return self._json(200, {"ok": True, "session_id": sid, "mockup_html": out.get("mockup_html", ""),
                                "nombre_proyecto": out.get("nombre_proyecto", ""), "quote": q,
                                "source": "free", "remaining_free": FREE_PER_WEEK, "remaining_credits": 0, "iters_left": 12})

    def h_solicitud(self, data):
        d = load_data()
        uk, email = self._resolve(d, data.get("token") or "")
        if not uk:
            return self._json(401, {"error": "invalid_session"})
        sid = data.get("session_id")
        s = (d.get("esp_sessions") or {}).get(sid)
        if not s or s.get("user") != uk:
            return self._json(404, {"error": "session_not_found"})
        d.setdefault("solicitudes", []).append({
            "user": uk, "email": email or s.get("email"), "nombre_proyecto": s.get("nombre"),
            "dra": s.get("dra"), "params": s.get("params"),
        })
        save_data(d)
        q = None
        try:
            q = compute_quote(load_cfg(), s.get("params") or {}, date.today().isoformat())
        except Exception:
            pass
        return self._json(200, {"ok": True, "nombre_proyecto": s.get("nombre") or "Proyecto",
                                "email": email or s.get("email"), "quote": q})

    def h_login(self, data):
        email = (data.get("email") or "").strip().lower()
        pw = data.get("password") or ""
        mode = data.get("mode") or "login"
        if not email or len(pw) < 6:
            return self._json(400, {"error": "bad_input",
                                    "error_es": "Correo válido y contraseña de 6+ caracteres."})
        d = load_data()
        users = d["users"]
        if mode == "signup":
            if email in users:
                return self._json(400, {"error": "exists",
                                        "error_es": "Ese correo ya tiene cuenta. Entra con tu contraseña."})
            users[email] = {"pw": hpw(pw), "window_start": None, "free_used": 0, "paid_credits": 0}
        else:
            u = users.get(email)
            if not u or u.get("pw") != hpw(pw):
                return self._json(401, {"error": "invalid",
                                        "error_es": "Correo o contraseña incorrectos."})
        tok = secrets.token_hex(16)
        d["sessions"][tok] = email
        save_data(d)
        return self._json(200, {"token": tok, "email": email})

    def h_cotizar(self, data):
        d = load_data()
        token = data.get("token") or ""
        # 1) ¿sesión local?  2) si no, ¿JWT de Supabase válido? (cuando ya lo configuraste)
        user_key = d["sessions"].get(token)
        if not (user_key and user_key in d["users"]):
            uid = validate_supabase(supa_cfg(), token)
            if uid:
                user_key = "supa:" + uid
            else:
                return self._json(401, {"error": "invalid_session"})
        try:
            cfg = load_cfg()
        except Exception:
            return self._json(500, {"error": "config"})
        u = d["users"].get(user_key) or {"window_start": None, "free_used": 0, "paid_credits": 0}
        source = "free"
        paid = u.get("paid_credits", 0)
        remaining_free = FREE_PER_WEEK

        if ENFORCE:
            now = datetime.now(timezone.utc)
            ws = None
            if u.get("window_start"):
                try:
                    ws = datetime.fromisoformat(u["window_start"])
                except Exception:
                    ws = None
            window_start = ws or now
            free_used = u.get("free_used", 0)
            if ws is None or (now - ws).total_seconds() >= SEVEN_DAYS:
                window_start = now
                free_used = 0
            if free_used < FREE_PER_WEEK:
                free_used += 1
                source = "free"
            elif paid > 0:
                paid -= 1
                source = "paid"
            else:
                nxt = window_start.timestamp() + SEVEN_DAYS
                return self._json(429, {
                    "error": "rate_limited", "free_per_week": FREE_PER_WEEK,
                    "next_available": datetime.fromtimestamp(nxt, timezone.utc).isoformat(),
                    "days_left": max(1, int((nxt - now.timestamp()) // 86400) + 1),
                    "paid_credits": paid, "can_buy": True,
                })
            u["window_start"] = window_start.isoformat()
            u["free_used"] = free_used
            u["paid_credits"] = paid
            d["users"][user_key] = u
            save_data(d)
            remaining_free = max(0, FREE_PER_WEEK - free_used)

        quote = compute_quote(cfg, {
            "tipo": data.get("tipo"), "complejidad": data.get("complejidad"),
            "plataformas": data.get("plataformas") or [], "addons": data.get("addons") or [],
            "urgencia": bool(data.get("urgencia")),
        }, date.today().isoformat())

        return self._json(200, {
            "ok": True, "mode": "free", "ai_used": False, "ai_available": False,
            "source": source, "free_per_week": FREE_PER_WEEK,
            "remaining_free": remaining_free, "remaining_credits": paid, "quote": quote,
        })


def main():
    start = int(sys.argv[1]) if len(sys.argv) > 1 else 4321
    do_open = len(sys.argv) > 2 and sys.argv[2] == "open"
    Handler = functools.partial(H, directory=DIR)

    class S(socketserver.TCPServer):
        allow_reuse_address = True

    # Busca un puerto libre desde `start` (por si 4321 está ocupado).
    httpd = None
    port = None
    for p in range(start, start + 20):
        try:
            httpd = S(("127.0.0.1", p), Handler)
            port = p
            break
        except OSError as e:
            if e.errno in (48, 98):  # Address already in use (macOS 48 / Linux 98)
                continue
            raise
    if httpd is None:
        print("No hay puerto libre entre %d y %d. Cierra otros servidores y reintenta." % (start, start + 19))
        sys.exit(1)

    url = "http://127.0.0.1:%d/" % port
    print("──────────────────────────────────────────────")
    print("  Ap-Ab — backend local listo")
    print("  " + url)
    if port != start:
        print("  (el puerto %d estaba ocupado; usé %d)" % (start, port))
    print("  Limite 2/semana: " + ("ACTIVADO" if ENFORCE else "desactivado (pruebas libres)"))
    print("  Cierra esta ventana para apagar.")
    print("──────────────────────────────────────────────")
    if do_open:
        try:
            webbrowser.open(url)
        except Exception:
            pass
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nApagado.")
    finally:
        try:
            httpd.server_close()
        except Exception:
            pass


if __name__ == "__main__":
    main()
