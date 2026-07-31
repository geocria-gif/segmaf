import os, smtplib, uuid
from email.message import EmailMessage
from dotenv import load_dotenv
from flask import Flask, request, jsonify
from flask_cors import CORS
load_dotenv()

app = Flask(__name__)
CORS(app)

EMAIL_REMETENTE = os.getenv("EMAIL_REMETENTE", "segmaf@outlook.com")
SENHA_REMETENTE = os.getenv("SENHA_EMAIL")
EMAIL_DESTINO = "segmaf@outlook.com"
SMTP_SERVER = "smtp-mail.outlook.com"
SMTP_PORT = 587

@app.route("/submit", methods=["POST"])
def submit():
    nome = request.form.get("nome", "").strip()
    email = request.form.get("email", "").strip()
    telefone = request.form.get("telefone", "").strip()
    assunto = request.form.get("assunto", "").strip()
    mensagem = request.form.get("mensagem", "").strip()
    arquivos = request.files.getlist("anexo")

    if not nome or not email or not assunto:
        return jsonify({"erro": "Preencha nome, email e assunto."}), 400

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
            msg.add_attachment(dados, maintype="application", subtype="octet-stream", filename=f.filename, cid=str(uuid.uuid4()))

    try:
        with smtplib.SMTP(SMTP_SERVER, SMTP_PORT) as smtp:
            smtp.starttls()
            smtp.login(EMAIL_REMETENTE, SENHA_REMETENTE)
            smtp.send_message(msg)
        return jsonify({"ok": True, "mensagem": "Recebemos sua solicita\u00E7\u00E3o!"}), 200
    except Exception as e:
        return jsonify({"erro": f"Erro ao enviar email: {str(e)}"}), 500

if __name__ == "__main__":
    print("Servidor SEGMAF rodando em http://localhost:5000")
    app.run(host="0.0.0.0", port=5000, debug=True)
