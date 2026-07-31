import os, smtplib, uuid, threading
from email.message import EmailMessage
from dotenv import load_dotenv
from flask import Flask, request, jsonify
from flask_cors import CORS
load_dotenv()

app = Flask(__name__)
CORS(app)

EMAIL_REMETENTE = os.getenv("EMAIL_REMETENTE", "")
SENHA_REMETENTE = os.getenv("SENHA_EMAIL", "")
EMAIL_DESTINO = "segmaf@outlook.com"
SMTP_SERVER = "smtp.gmail.com"
SMTP_PORT = 587

_smtp_lock = threading.Lock()
_smtp_conn = None

def get_smtp():
    global _smtp_conn
    with _smtp_lock:
        if _smtp_conn is None:
            s = smtplib.SMTP(SMTP_SERVER, SMTP_PORT, timeout=5)
            s.starttls()
            s.login(EMAIL_REMETENTE, SENHA_REMETENTE)
            _smtp_conn = s
        return _smtp_conn

def enviar_email_async(msg):
    try:
        s = get_smtp()
        with _smtp_lock:
            s.send_message(msg)
    except Exception:
        global _smtp_conn
        with _smtp_lock:
            _smtp_conn = None

@app.route("/submit", methods=["POST"])
def submit():
    nome = request.form.get("nome", "").strip()
    email = request.form.get("email", "").strip()
    telefone = request.form.get("telefone", "").strip()
    assunto = request.form.get("assunto", "").strip()
    mensagem = request.form.get("mensagem", "").strip()
    arquivos = request.files.getlist("anexo")[:5]

    if not nome or not email or not assunto:
        return jsonify({"erro": "Preencha nome, email e assunto."}), 400
    if not EMAIL_REMETENTE or not SENHA_REMETENTE:
        return jsonify({"erro": "Servidor de email n\u00E3o configurado."}), 500

    corpo = f"""Nova solicita\u00E7\u00E3o do site SEGMAF

Nome: {nome}
E-mail: {email}
Telefone: {telefone}
Assunto: {assunto}

Mensagem:
{mensagem}
"""

    msg = EmailMessage()
    msg["From"] = EMAIL_REMETENTE
    msg["To"] = EMAIL_DESTINO
    msg["Subject"] = f"[SEGMAF Site] {assunto} - {nome}"
    msg.set_content(corpo)

    for f in arquivos:
        if f.filename:
            dados = f.read()
            msg.add_attachment(dados, maintype="application", subtype="octet-stream", filename=f.filename)

    threading.Thread(target=enviar_email_async, args=(msg,), daemon=True).start()
    return jsonify({"ok": True, "mensagem": "Recebemos sua solicita\u00E7\u00E3o!"}), 200

if __name__ == "__main__":
    print("Servidor SEGMAF rodando em http://localhost:5000")
    app.run(host="0.0.0.0", port=5000, debug=False, threaded=True)
