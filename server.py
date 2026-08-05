import os
import smtplib
import datetime
from email.message import EmailMessage
from email.utils import formataddr

from flask import Flask, jsonify, request
from flask_cors import CORS
from sqlalchemy import create_engine, Column, Integer, String, Float, Text, DateTime
from sqlalchemy.orm import declarative_base, sessionmaker

app = Flask(__name__)
CORS(app, origins=[o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "*").split(",") if o.strip()])
app.config["MAX_CONTENT_LENGTH"] = int(os.environ.get("MAX_TOTAL_MB", "25")) * 1024 * 1024

# --- Banco de dados ------------------------------------------------------
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
if not DATABASE_URL:
    DATABASE_URL = "sqlite:///solicitacoes.db"
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = "postgresql://" + DATABASE_URL[len("postgres://"):]

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
Base = declarative_base()


class Solicitacao(Base):
    __tablename__ = "solicitacoes"
    id = Column(Integer, primary_key=True)
    criado_em = Column(DateTime, default=datetime.datetime.utcnow)
    nome = Column(String(120))
    email = Column(String(120))
    telefone = Column(String(40))
    cidade = Column(String(120))
    endereco = Column(String(255))
    latitude = Column(Float)
    longitude = Column(Float)
    assunto = Column(String(120))
    mensagem = Column(Text)


Base.metadata.create_all(engine)
Session = sessionmaker(bind=engine)

# --- Configuracoes --------------------------------------------------------
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "").strip()

SMTP_HOST = os.environ.get("SMTP_HOST", "smtp-relay.brevo.com")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASS = os.environ.get("SMTP_PASS", "")
EMAIL_FROM = os.environ.get("EMAIL_FROM", SMTP_USER) or SMTP_USER
EMAIL_TO = os.environ.get("EMAIL_TO", "segmaf@outlook.com")


def log(texto):
    print(texto, flush=True)


def float_ou_nulo(valor):
    if not valor:
        return None
    try:
        return float(valor)
    except (TypeError, ValueError):
        return None


# --- SMTP opcional (nunca bloqueia a resposta) -----------------------------
def enviar_email_async(dados):
    try:
        if not (SMTP_USER and SMTP_PASS):
            return
        msg = EmailMessage()
        msg["From"] = formataddr(("Site SEGMAF", EMAIL_FROM))
        msg["To"] = EMAIL_TO
        msg["Subject"] = f"[SEGMAF Site] {dados['assunto']} - {dados['nome']}"
        texto = (
            f"Nova solicitação de orçamento\n\n"
            f"Nome: {dados['nome']}\nE-mail: {dados['email']}\nTelefone: {dados['telefone'] or 'não informado'}\n"
            f"Cidade: {dados['cidade'] or 'não informada'}\nEndereço: {dados['endereco'] or 'não informado'}\n"
            f"Latitude: {dados['latitude'] or ''}  Longitude: {dados['longitude'] or ''}\n"
            f"Assunto: {dados['assunto']}\n\nMensagem:\n{dados['mensagem']}"
        )
        msg.set_content(texto)
        portas = list(dict.fromkeys([SMTP_PORT, 2525]))
        ultimo_erro = None
        for porta in portas:
            try:
                with smtplib.SMTP(SMTP_HOST, porta, timeout=15) as smtp:
                    smtp.starttls()
                    smtp.login(SMTP_USER, SMTP_PASS)
                    smtp.send_message(msg)
                log(f"E-mail enviado para {EMAIL_TO} via {SMTP_HOST}:{porta}")
                return
            except Exception as e:
                ultimo_erro = e
        log(f"ERRO SMTP (opcional): {ultimo_erro!r}")
    except Exception as e:
        log(f"ERRO SMTP (opcional): {e!r}")


# --- Autenticacao do admin --------------------------------------------------
def autorizado():
    if not ADMIN_TOKEN:
        return False
    cabecalho = request.headers.get("Authorization", "")
    if cabecalho == f"Bearer {ADMIN_TOKEN}":
        return True
    return request.args.get("token") == ADMIN_TOKEN


# --- Rotas -----------------------------------------------------------------
@app.route("/", methods=["GET"])
def health():
    return jsonify({"status": "ok", "servico": "SEGMAF API", "build": "db-v1"}), 200


@app.route("/api/orcamento", methods=["POST"])
def api_orcamento():
    pedido = request.form
    nome = (pedido.get("nome") or "").strip()
    email = (pedido.get("email") or "").strip()
    assunto = (pedido.get("assunto") or "").strip()
    mensagem = (pedido.get("mensagem") or "").strip()
    if not nome or not email or not assunto or not mensagem:
        return jsonify({"success": False, "message": "Preencha todos os campos obrigatórios."}), 400

    sol = Solicitacao(
        nome=nome,
        email=email,
        telefone=(pedido.get("telefone") or "").strip(),
        cidade=(pedido.get("cidade") or "").strip(),
        endereco=(pedido.get("endereco") or "").strip(),
        latitude=float_ou_nulo(pedido.get("latitude")),
        longitude=float_ou_nulo(pedido.get("longitude")),
        assunto=assunto,
        mensagem=mensagem,
    )
    try:
        with Session.begin() as sess:
            sess.add(sol)
            sess.flush()
            novo_id = sol.id
    except Exception as e:
        log(f"ERRO ao salvar no banco: {e!r}")
        return jsonify({"success": False, "message": "Erro ao salvar sua solicitação. Tente novamente."}), 500

    log(f"Solicitação #{novo_id} salva: {nome} / {assunto}")
    import threading
    threading.Thread(
        target=enviar_email_async,
        args=({
            "nome": nome,
            "email": email,
            "telefone": (pedido.get("telefone") or "").strip(),
            "cidade": (pedido.get("cidade") or "").strip(),
            "endereco": (pedido.get("endereco") or "").strip(),
            "latitude": float_ou_nulo(pedido.get("latitude")),
            "longitude": float_ou_nulo(pedido.get("longitude")),
            "assunto": assunto,
            "mensagem": mensagem,
        },),
        daemon=True,
    ).start()
    return jsonify({"success": True, "message": "Recebemos sua solicitação! Entraremos em contato em breve."}), 200


@app.route("/api/admin/solicitacoes", methods=["GET"])
def admin_solicitacoes():
    if not autorizado():
        return jsonify({"success": False, "message": "Não autorizado."}), 401
    sess = Session()
    try:
        itens = sess.query(Solicitacao).order_by(Solicitacao.id.desc()).limit(500).all()
        return jsonify({
            "success": True,
            "total": len(itens),
            "solicitacoes": [{
                "id": s.id,
                "criado_em": s.criado_em.isoformat() if s.criado_em else None,
                "nome": s.nome,
                "email": s.email,
                "telefone": s.telefone,
                "cidade": s.cidade,
                "endereco": s.endereco,
                "latitude": s.latitude,
                "longitude": s.longitude,
                "assunto": s.assunto,
                "mensagem": s.mensagem,
            } for s in itens]
        }), 200
    finally:
        sess.close()


@app.route("/api/admin/solicitacoes/<int:sid>", methods=["DELETE"])
def admin_excluir(sid):
    if not autorizado():
        return jsonify({"success": False, "message": "Não autorizado."}), 401
    with Session.begin() as sess:
        sol = sess.get(Solicitacao, sid)
        if not sol:
            return jsonify({"success": False, "message": "Solicitação não encontrada."}), 404
        sess.delete(sol)
    log(f"Solicitação #{sid} excluída")
    return jsonify({"success": True}), 200


if __name__ == "__main__":
    print("API SEGMAF rodando em http://localhost:5000")
    app.run(host="0.0.0.0", port=5000, debug=False, threaded=True)
