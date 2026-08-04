import os
import smtplib
from email.message import EmailMessage
from email.utils import formataddr

from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app, origins=[o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "*").split(",") if o.strip()])
app.config["MAX_CONTENT_LENGTH"] = int(os.environ.get("MAX_TOTAL_MB", "25")) * 1024 * 1024

SMTP_HOST = os.environ.get("SMTP_HOST", "smtp.office365.com")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASS = os.environ.get("SMTP_PASS", "")
EMAIL_FROM = os.environ.get("EMAIL_FROM", SMTP_USER) or SMTP_USER
EMAIL_TO = os.environ.get("EMAIL_TO", "segmaf@outlook.com")

MAX_FILES = int(os.environ.get("MAX_FILES", "5"))
MAX_FILE_MB = int(os.environ.get("MAX_FILE_MB", "8"))
MAX_TOTAL_MB = int(os.environ.get("MAX_TOTAL_MB", "20"))


def log(texto):
    print(texto, flush=True)


def validar(pedido, arquivos):
    for campo in ("nome", "email", "assunto", "mensagem"):
        if not pedido.get(campo, "").strip():
            return None, "Preencha todos os campos obrigatórios."
    if len(arquivos) > MAX_FILES:
        return None, f"Envie no máximo {MAX_FILES} anexos."
    total = 0
    for arq in arquivos:
        if not arq.filename:
            continue
        arq.stream.seek(0, os.SEEK_END)
        tamanho = arq.stream.tell()
        arq.stream.seek(0)
        if tamanho > MAX_FILE_MB * 1024 * 1024:
            return None, f"O arquivo '{arq.filename}' excede {MAX_FILE_MB}MB."
        total += tamanho
    if total > MAX_TOTAL_MB * 1024 * 1024:
        return None, f"Anexos excedem {MAX_TOTAL_MB}MB no total."
    return True, None


def montar_email(pedido):
    nome = pedido.get("nome", "").strip()
    email = pedido.get("email", "").strip()
    telefone = pedido.get("telefone", "").strip()
    assunto = pedido.get("assunto", "").strip()
    mensagem = pedido.get("mensagem", "").strip()

    texto = f"""Nova solicitação de orçamento recebida pelo site SEGMAF

Nome: {nome}
E-mail: {email}
Telefone: {telefone or "não informado"}
Assunto: {assunto}

Mensagem:
{mensagem}
"""

    html = f"""<html><body style="font-family:Arial,sans-serif;color:#0A2540">
<h2 style="color:#0A2540;border-bottom:3px solid #F26522;padding-bottom:8px">Nova solicitação de orçamento</h2>
<table style="border-collapse:collapse" cellpadding="6">
<tr><td style="font-weight:bold">Nome</td><td>{nome}</td></tr>
<tr><td style="font-weight:bold">E-mail</td><td>{email}</td></tr>
<tr><td style="font-weight:bold">Telefone</td><td>{telefone or "não informado"}</td></tr>
<tr><td style="font-weight:bold">Assunto</td><td>{assunto}</td></tr>
</table>
<p style="font-weight:bold;margin-top:12px">Mensagem:</p>
<p>{mensagem.replace(chr(10), "<br>")}</p>
<hr>
<p style="color:#777;font-size:12px">Enviado automaticamente pelo site segmaf.com.br</p>
</body></html>"""

    msg = EmailMessage()
    msg["From"] = formataddr(("Site SEGMAF", EMAIL_FROM))
    msg["To"] = EMAIL_TO
    msg["Subject"] = f"[SEGMAF Site] {assunto} - {nome}"
    msg.set_content(texto)
    msg.add_alternative(html, subtype="html")
    return msg


def processar(pedido, arquivos):
    ok, erro = validar(pedido, arquivos)
    if not ok:
        return jsonify({"success": False, "message": erro}), 400
    if not SMTP_USER or not SMTP_PASS:
        return jsonify({"success": False, "message": "Servidor de e-mail não configurado."}), 500

    msg = montar_email(pedido)
    for arq in arquivos:
        if arq.filename:
            nome = os.path.basename(arq.filename)
            msg.add_attachment(arq.read(), maintype="application", subtype="octet-stream", filename=nome)

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15) as smtp:
            smtp.starttls()
            smtp.login(SMTP_USER, SMTP_PASS)
            smtp.send_message(msg)
        log(f"E-mail enviado para {EMAIL_TO} - assunto: {msg['Subject']}")
        return jsonify({"success": True, "message": "Recebemos sua solicitação! Entraremos em contato em breve."}), 200
    except Exception as e:
        log(f"ERRO ao enviar e-mail: {e!r}")
        return jsonify({"success": False, "message": "Erro ao enviar sua solicitação. Tente novamente em instantes."}), 500


@app.route("/", methods=["GET"])
def health():
    return jsonify({"status": "ok", "servico": "SEGMAF API", "build": "diagnostico-2"}), 200


@app.route("/api/orcamento", methods=["POST"])
def api_orcamento():
    try:
        return processar(request.form, request.files.getlist("anexo"))
    except Exception as e:
        log(f"ERRO nao tratado no /api/orcamento: {e!r}")
        return jsonify({"success": False, "message": f"Erro interno do servidor: {e!r}"}), 500


@app.route("/submit", methods=["POST"])
def submit():
    return api_orcamento()


if __name__ == "__main__":
    print("API SEGMAF rodando em http://localhost:5000")
    app.run(host="0.0.0.0", port=5000, debug=False, threaded=True)
