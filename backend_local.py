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
import os, sys, json, http.server, socketserver, functools, hashlib, secrets, webbrowser
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
        return self._json(404, {"error": "not_found"})

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
        email = d["sessions"].get(data.get("token") or "")
        if not email or email not in d["users"]:
            return self._json(401, {"error": "invalid_session"})
        try:
            cfg = load_cfg()
        except Exception:
            return self._json(500, {"error": "config"})
        u = d["users"][email]
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
