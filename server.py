import os
import base64
import smtplib
import datetime
from email.message import EmailMessage
from email.utils import formataddr
from urllib.parse import quote

from flask import Flask, jsonify, request, Response
from flask_cors import CORS
from sqlalchemy import create_engine, Column, Integer, String, Float, Boolean, Text, DateTime, text
from sqlalchemy import inspect as sqlalchemy_inspect
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
    lido = Column(Boolean, default=False)
    atendido = Column(Boolean, default=False)


class Anexo(Base):
    __tablename__ = "anexos"
    id = Column(Integer, primary_key=True)
    solicitacao_id = Column(Integer, index=True)
    nome_arquivo = Column(String(255))
    mime_type = Column(String(120))
    tamanho = Column(Integer)
    dados = Column(Text)


class Meta(Base):
    __tablename__ = "metas"
    chave = Column(String(50), primary_key=True)
    valor = Column(Integer, default=0)


class Imagem(Base):
    __tablename__ = "imagens"
    chave = Column(String(50), primary_key=True)
    dados = Column(Text)
    mime = Column(String(120))
    nome = Column(String(255))
    tamanho = Column(Integer)
    atualizada_em = Column(DateTime, default=datetime.datetime.utcnow)


Base.metadata.create_all(engine)
Session = sessionmaker(bind=engine)


def log(texto):
    print(texto, flush=True)


def migrar_tabela():
    try:
        insp = sqlalchemy_inspect(engine)
        if "solicitacoes" in insp.get_table_names():
            colunas = {c["name"] for c in insp.get_columns("solicitacoes")}
            with engine.begin() as conn:
                for col in ("lido", "atendido"):
                    if col not in colunas:
                        conn.execute(text(f"ALTER TABLE solicitacoes ADD COLUMN {col} BOOLEAN NOT NULL DEFAULT FALSE"))
                        log(f"Migracao: coluna {col} adicionada a solicitacoes")
        with Session.begin() as sess:
            if not sess.get(Meta, "atendidos_total"):
                n = sess.query(Solicitacao).filter(Solicitacao.atendido.is_(True)).count()
                sess.add(Meta(chave="atendidos_total", valor=n))
                log(f"Migracao: contador atendidos_total iniciado em {n}")
    except Exception as e:
        log(f"Migracao: erro {e!r}")


migrar_tabela()

# --- Configuracoes --------------------------------------------------------
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "").strip()
MAX_ANEXOS = int(os.environ.get("MAX_ANEXOS", "3"))
MAX_ANEXOS_BYTES = int(os.environ.get("MAX_ANEXOS_BYTES", str(5 * 1024 * 1024)))
MAX_IMAGEM_BYTES = int(os.environ.get("MAX_IMAGEM_MB", "3")) * 1024 * 1024

CARD_KEYS = [
    "limpeza-paineis-solares",
    "limpeza-pos-obras",
    "capina-quimica-usina-solar",
    "capina-corporativa",
    "rocagem-usina-solar",
    "pulverizacao-area-irrigada",
    "captura-de-abelhas",
    "limpeza-cercamento-aceiros",
]

SMTP_HOST = os.environ.get("SMTP_HOST", "smtp-relay.brevo.com")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASS = os.environ.get("SMTP_PASS", "")
EMAIL_FROM = os.environ.get("EMAIL_FROM", SMTP_USER) or SMTP_USER
EMAIL_TO = os.environ.get("EMAIL_TO", "segmaf@outlook.com")


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
    conectado = False
    try:
        with Session() as s:
            s.execute(text("SELECT 1"))
            conectado = True
    except Exception as e:
        log(f"Health: banco indisponível: {e!r}")
    return jsonify({
        "status": "ok",
        "servico": "SEGMAF API",
        "build": "db-v1",
        "banco": engine.dialect.name,
        "banco_conectado": conectado,
    }), 200


@app.route("/api/contadores", methods=["GET"])
def contadores():
    try:
        with Session() as sess:
            meta = sess.get(Meta, "atendidos_total")
            atendidos = meta.valor if meta else 0
            nao_lidos = sess.query(Solicitacao).filter(Solicitacao.lido.is_(False)).count()
        return jsonify({"success": True, "atendidos": atendidos, "nao_lidos": nao_lidos}), 200
    except Exception as e:
        log(f"Contadores: {e!r}")
        return jsonify({"success": False, "atendidos": 0, "nao_lidos": 0}), 500


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

    anexos = [(a, a.read()) for a in request.files.getlist("anexo") if a and a.filename]
    if len(anexos) > MAX_ANEXOS:
        return jsonify({"success": False, "message": f"Máximo de {MAX_ANEXOS} anexos por solicitação."}), 400
    total_anexos = sum(len(c) for _, c in anexos)
    if total_anexos > MAX_ANEXOS_BYTES:
        return jsonify({"success": False, "message": "O total dos anexos não pode passar de 5 MB."}), 400
    for a, c in anexos:
        mt = (a.mimetype or "").lower()
        nome = (a.filename or "").lower()
        if not (mt.startswith("image/") or mt == "application/pdf" or nome.endswith(".pdf")):
            return jsonify({"success": False, "message": "Somente imagens ou arquivos PDF são permitidos."}), 400

    try:
        with Session.begin() as sess:
            sess.add(sol)
            sess.flush()
            novo_id = sol.id
            for a, c in anexos:
                sess.add(Anexo(
                    solicitacao_id=novo_id,
                    nome_arquivo=a.filename,
                    mime_type=a.mimetype or "application/octet-stream",
                    tamanho=len(c),
                    dados=base64.b64encode(c).decode("ascii"),
                ))
    except Exception as e:
        log(f"ERRO ao salvar no banco: {e!r}")
        return jsonify({"success": False, "message": "Erro ao salvar sua solicitação. Tente novamente."}), 500

    log(f"Solicitação #{novo_id} salva: {nome} / {assunto} ({len(anexos)} anexo(s))")
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


@app.route("/api/cartoes", methods=["GET"])
def cartoes():
    try:
        with Session() as sess:
            custom = {c.chave: c for c in sess.query(Imagem).filter(Imagem.chave.in_(CARD_KEYS)).all()}
        resultado = {}
        for chave in CARD_KEYS:
            c = custom.get(chave)
            if c and c.dados:
                ts = int(c.atualizada_em.timestamp()) if c.atualizada_em else 0
                resultado[chave] = f"/api/imagem/{chave}?v={ts}"
            else:
                resultado[chave] = None
        return jsonify({"success": True, "cartoes": resultado}), 200
    except Exception as e:
        log(f"Cartoes: {e!r}")
        return jsonify({"success": False, "cartoes": {}}), 500


@app.route("/api/imagem/<chave>", methods=["GET"])
def imagem_publica(chave):
    if chave not in CARD_KEYS:
        return jsonify({"success": False, "message": "Chave inválida."}), 404
    sess = Session()
    try:
        img = sess.get(Imagem, chave)
        if not img or not img.dados:
            return jsonify({"success": False, "message": "Imagem não encontrada."}), 404
        dados = base64.b64decode(img.dados)
        resp = Response(dados, mimetype=img.mime or "image/png")
        resp.headers["Cache-Control"] = "public, max-age=3600"
        return resp
    except Exception as e:
        log(f"Imagem {chave}: {e!r}")
        return jsonify({"success": False, "message": "Erro ao carregar a imagem."}), 500
    finally:
        sess.close()


@app.route("/api/admin/imagens", methods=["GET"])
def admin_imagens():
    if not autorizado():
        return jsonify({"success": False, "message": "Não autorizado."}), 401
    sess = Session()
    try:
        custom = {c.chave: c for c in sess.query(Imagem).all()}
        resultado = []
        for chave in CARD_KEYS:
            c = custom.get(chave)
            resultado.append({
                "chave": chave,
                "custom": bool(c and c.dados),
                "nome": c.nome if c else None,
                "mime": c.mime if c else None,
                "tamanho": c.tamanho if c else None,
                "atualizada_em": c.atualizada_em.isoformat() if c and c.atualizada_em else None,
                "url": f"/api/imagem/{chave}" if c and c.dados else None,
            })
        return jsonify({"success": True, "imagens": resultado}), 200
    finally:
        sess.close()


@app.route("/api/admin/imagens/<chave>", methods=["PUT"])
def admin_enviar_imagem(chave):
    if not autorizado():
        return jsonify({"success": False, "message": "Não autorizado."}), 401
    if chave not in CARD_KEYS:
        return jsonify({"success": False, "message": "Chave inválida."}), 400
    dados = None
    mime = None
    nome = None
    arquivo = request.files.get("arquivo")
    if arquivo and arquivo.filename:
        dados = arquivo.read()
        mime = arquivo.mimetype or "image/png"
        nome = arquivo.filename
    else:
        j = request.get_json(silent=True) or {}
        if j.get("dados"):
            try:
                dados = base64.b64decode(j["dados"])
            except Exception:
                return jsonify({"success": False, "message": "Dados inválidos."}), 400
            mime = j.get("mime") or "image/png"
            nome = j.get("nome")
    if not dados:
        return jsonify({"success": False, "message": "Envie um arquivo de imagem."}), 400
    if not (mime or "").startswith("image/"):
        return jsonify({"success": False, "message": "Somente imagens (JPG, PNG, WebP) são permitidas."}), 400
    if len(dados) > MAX_IMAGEM_BYTES:
        return jsonify({"success": False, "message": "A imagem não pode passar de 3 MB."}), 400
    with Session.begin() as sess:
        img = sess.get(Imagem, chave)
        codigo = base64.b64encode(dados).decode("ascii")
        agora = datetime.datetime.utcnow()
        if img:
            img.dados = codigo
            img.mime = mime
            img.nome = nome
            img.tamanho = len(dados)
            img.atualizada_em = agora
        else:
            sess.add(Imagem(chave=chave, dados=codigo, mime=mime, nome=nome,
                            tamanho=len(dados), atualizada_em=agora))
    log(f"Imagem do card '{chave}' atualizada ({len(dados)} bytes)")
    return jsonify({"success": True, "url": f"/api/imagem/{chave}"}), 200


@app.route("/api/admin/imagens/<chave>", methods=["DELETE"])
def admin_remover_imagem(chave):
    if not autorizado():
        return jsonify({"success": False, "message": "Não autorizado."}), 401
    if chave not in CARD_KEYS:
        return jsonify({"success": False, "message": "Chave inválida."}), 400
    with Session.begin() as sess:
        img = sess.get(Imagem, chave)
        if img:
            sess.delete(img)
    log(f"Imagem do card '{chave}' restaurada para o padrão")
    return jsonify({"success": True}), 200


@app.route("/api/admin/solicitacoes", methods=["GET"])
def admin_solicitacoes():
    if not autorizado():
        return jsonify({"success": False, "message": "Não autorizado."}), 401
    sess = Session()
    try:
        itens = sess.query(Solicitacao).order_by(Solicitacao.id.desc()).limit(500).all()
        ids = [s.id for s in itens]
        anexos_por_sol = {}
        if ids:
            for a in sess.query(Anexo).filter(Anexo.solicitacao_id.in_(ids)).all():
                anexos_por_sol.setdefault(a.solicitacao_id, []).append({
                    "id": a.id,
                    "nome": a.nome_arquivo,
                    "mime": a.mime_type,
                    "tamanho": a.tamanho,
                })
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
                "lido": bool(s.lido),
                "atendido": bool(s.atendido),
                "anexos": anexos_por_sol.get(s.id, []),
            } for s in itens]
        }), 200
    finally:
        sess.close()


@app.route("/api/admin/anexo/<int:aid>", methods=["GET"])
def admin_anexo(aid):
    if not autorizado():
        return jsonify({"success": False, "message": "Não autorizado."}), 401
    sess = Session()
    try:
        a = sess.get(Anexo, aid)
        if not a:
            return jsonify({"success": False, "message": "Anexo não encontrado."}), 404
        dados = base64.b64decode(a.dados or "")
        resp = Response(dados, mimetype=a.mime_type or "application/octet-stream")
        resp.headers["Content-Disposition"] = "attachment"
        resp.headers["X-Anexo-Nome"] = quote(a.nome_arquivo or "anexo")
        return resp
    finally:
        sess.close()


@app.route("/api/admin/contador/atendidos", methods=["PUT"])
def admin_ajustar_contador():
    if not autorizado():
        return jsonify({"success": False, "message": "Não autorizado."}), 401
    dados = request.get_json(silent=True) or {}
    try:
        valor = int(dados.get("valor", -1))
    except (TypeError, ValueError):
        valor = -1
    if valor < 0:
        return jsonify({"success": False, "message": "Valor inválido."}), 400
    with Session.begin() as sess:
        meta = sess.get(Meta, "atendidos_total")
        if not meta:
            sess.add(Meta(chave="atendidos_total", valor=valor))
        else:
            meta.valor = valor
    log(f"Contador atendidos ajustado para {valor}")
    return jsonify({"success": True, "atendidos": valor}), 200


@app.route("/api/admin/solicitacoes/<int:sid>", methods=["PATCH"])
def admin_atualizar(sid):
    if not autorizado():
        return jsonify({"success": False, "message": "Não autorizado."}), 401
    dados = request.get_json(silent=True) or {}
    campos = {}
    if "lido" in dados:
        campos["lido"] = bool(dados["lido"])
    if "atendido" in dados:
        campos["atendido"] = bool(dados["atendido"])
    if not campos:
        return jsonify({"success": False, "message": "Nenhum campo válido para atualizar."}), 400
    with Session.begin() as sess:
        sol = sess.get(Solicitacao, sid)
        if not sol:
            return jsonify({"success": False, "message": "Solicitação não encontrada."}), 404
        if "atendido" in dados:
            novo = bool(dados["atendido"])
            if novo != bool(sol.atendido):
                meta = sess.get(Meta, "atendidos_total")
                if not meta:
                    meta = Meta(chave="atendidos_total", valor=0)
                    sess.add(meta)
                meta.valor = (meta.valor or 0) + (1 if novo else -1)
            sol.atendido = novo
        if "lido" in dados:
            sol.lido = bool(dados["lido"])
    log(f"Solicitação #{sid} atualizada: {list(campos)}")
    return jsonify({"success": True}), 200


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
