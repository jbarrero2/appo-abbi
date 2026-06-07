#!/usr/bin/env python3
# Servidor estático para PROBAR en local (no es parte del deploy).
# Uso:  python3 serve.py    →    http://127.0.0.1:4321
# (Sirve un directorio explícito para evitar problemas de sandbox/getcwd.)
import functools
import http.server
import socketserver

DIRECTORY = "/Users/jeronimo/Downloads/ap-ab-web"
PORT = 4321

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=DIRECTORY)


class Server(socketserver.TCPServer):
    allow_reuse_address = True


with Server(("127.0.0.1", PORT), Handler) as httpd:
    print(f"Ap-Ab en http://127.0.0.1:{PORT}  (Ctrl+C para parar)")
    httpd.serve_forever()
