(function (global) {
  'use strict';

  var SUPABASE_URL = 'https://aeznatotbwggqsawbgvl.supabase.co';
  var SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_64h7P8IGIhGI-JwxTyS5pA_cH762sPC';
  var ANEXOS_BUCKET = 'anexos';
  var IMAGENS_BUCKET = 'imagens-cards';
  var MAX_ANEXOS = 3;
  var MAX_TOTAL_BYTES = 5 * 1024 * 1024;
  var TURNSTILE_SITE_KEY = '0x4AAAAAAETYJiUUal_v1b6J';
  var turnstilePromise = null;
  var formCaptchaWidget = null;

  if (!global.supabase || typeof global.supabase.createClient !== 'function') {
    throw new Error('Supabase JS v2 deve ser carregado antes de supabase-client.js.');
  }

  var db = global.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

  function texto(formData, nome) {
    var valor = formData.get(nome);
    return typeof valor === 'string' ? valor.trim() : '';
  }

  function validarFormulario(formData) {
    var campos = {
      nome: texto(formData, 'nome'),
      email: texto(formData, 'email').toLowerCase(),
      telefone: texto(formData, 'telefone'),
      cidade: texto(formData, 'cidade'),
      endereco: texto(formData, 'endereco'),
      latitude: texto(formData, 'latitude'),
      longitude: texto(formData, 'longitude'),
      assunto: texto(formData, 'assunto'),
      mensagem: texto(formData, 'mensagem')
    };
    var obrigatorios = [
      ['nome', 'nome'],
      ['email', 'e-mail'],
      ['assunto', 'assunto'],
      ['mensagem', 'mensagem']
    ];

    for (var i = 0; i < obrigatorios.length; i += 1) {
      if (!campos[obrigatorios[i][0]]) {
        throw new Error('Preencha o campo ' + obrigatorios[i][1] + '.');
      }
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(campos.email)) {
      throw new Error('Informe um e-mail válido.');
    }
    if (campos.nome.length > 120 || campos.email.length > 120 ||
        campos.assunto.length > 120 || campos.mensagem.length > 10000 ||
        campos.telefone.length > 40 || campos.cidade.length > 120 ||
        campos.endereco.length > 255) {
      throw new Error('Um ou mais campos excedem o tamanho permitido.');
    }

    campos.latitude = numeroCoordenada(campos.latitude, -90, 90, 'latitude');
    campos.longitude = numeroCoordenada(campos.longitude, -180, 180, 'longitude');
    return campos;
  }

  function numeroCoordenada(valor, minimo, maximo, nome) {
    if (!valor) return null;
    var numero = Number(valor.replace(',', '.'));
    if (!isFinite(numero) || numero < minimo || numero > maximo) {
      throw new Error('Informe uma ' + nome + ' válida.');
    }
    return numero;
  }

  function tipoDoArquivo(arquivo) {
    var tipo = (arquivo.type || '').toLowerCase();
    if (['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'].indexOf(tipo) !== -1) return tipo;
    if (/\.pdf$/i.test(arquivo.name || '')) return 'application/pdf';
    return '';
  }

  function validarAnexos(formData) {
    var arquivos = formData.getAll('anexo').filter(function (item) {
      return item && typeof item !== 'string' && item.name && item.size > 0;
    });
    var total = 0;

    if (arquivos.length > MAX_ANEXOS) {
      throw new Error('Envie no máximo 3 anexos.');
    }
    arquivos.forEach(function (arquivo) {
      if (!tipoDoArquivo(arquivo)) {
        throw new Error('O arquivo "' + arquivo.name + '" deve ser uma imagem ou PDF.');
      }
      total += arquivo.size;
    });
    if (total > MAX_TOTAL_BYTES) {
      throw new Error('O total dos anexos não pode ultrapassar 5 MB.');
    }
    return arquivos;
  }

  function carregarTurnstile() {
    if (global.turnstile) return Promise.resolve(global.turnstile);
    if (turnstilePromise) return turnstilePromise;
    turnstilePromise = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.onload = function () {
        if (global.turnstile) resolve(global.turnstile);
        else reject(new Error('Não foi possível carregar a verificação de segurança.'));
      };
      script.onerror = function () { reject(new Error('Não foi possível carregar a verificação de segurança.')); };
      document.head.appendChild(script);
    });
    return turnstilePromise;
  }

  async function renderizarCaptcha(container, action) {
    var alvo = typeof container === 'string' ? document.querySelector(container) : container;
    if (!alvo) throw new Error('Área de verificação de segurança não encontrada.');
    var turnstile = await carregarTurnstile();
    return turnstile.render(alvo, {
      sitekey: TURNSTILE_SITE_KEY,
      theme: 'auto',
      size: 'flexible',
      appearance: 'interaction-only',
      action: action || 'formulario'
    });
  }

  function obterCaptchaToken(widgetId) {
    if (widgetId == null || !global.turnstile) return '';
    return global.turnstile.getResponse(widgetId) || '';
  }

  function resetarCaptcha(widgetId) {
    if (widgetId != null && global.turnstile) global.turnstile.reset(widgetId);
  }

  async function prepararCaptchaFormulario() {
    var form = document.getElementById('contactForm');
    if (!form || document.getElementById('segmafCaptcha')) return;
    var area = document.createElement('div');
    area.id = 'segmafCaptcha';
    area.style.gridColumn = '1 / -1';
    area.style.width = '100%';
    area.style.minHeight = '65px';
    var botao = form.querySelector('button[type="submit"]');
    form.insertBefore(area, botao || null);
    try {
      formCaptchaWidget = await renderizarCaptcha(area, 'orcamento');
    } catch (erro) {
      area.textContent = erro.message;
      area.style.color = '#b91c1c';
      area.style.fontSize = '.85rem';
    }
  }

  async function garantirSessao(captchaToken) {
    var resultado = await db.auth.getSession();
    if (resultado.error) throw resultado.error;
    if (resultado.data.session) return resultado.data.session;

    if (!captchaToken) throw new Error('Confirme a verificação de segurança antes de enviar.');
    try {
      resultado = await db.auth.signInAnonymously({ options: { captchaToken: captchaToken } });
    } finally {
      resetarCaptcha(formCaptchaWidget);
    }
    if (resultado.error) throw resultado.error;
    if (!resultado.data.session) {
      throw new Error('Não foi possível iniciar uma sessão segura. Tente novamente.');
    }
    return resultado.data.session;
  }

  function primeiroRegistro(data) {
    return Array.isArray(data) ? data[0] : data;
  }

  function idSolicitacao(data) {
    var registro = primeiroRegistro(data);
    if (typeof registro === 'number' || typeof registro === 'string') return registro;
    return registro && (registro.solicitacao_id || registro.id);
  }

  function caminhoReservado(data) {
    var registro = primeiroRegistro(data);
    return registro && (registro.storage_path || registro.path);
  }

  async function desfazerEnvio(solicitacaoId, caminhos) {
    if (caminhos.length) {
      var remocao = await db.storage.from(ANEXOS_BUCKET).remove(caminhos);
      if (remocao.error) {
        console.error('Falha ao remover anexos de um envio incompleto:', remocao.error);
      }
    }
    if (solicitacaoId) {
      var cancelamento = await db.rpc('limpar_rascunho', { p_solicitacao_id: solicitacaoId });
      if (cancelamento.error) {
        console.error('Falha ao limpar rascunho de um envio incompleto:', cancelamento.error);
      }
    }
  }

  function mensagemErro(erro) {
    var mensagem = erro && erro.message ? erro.message : '';
    if (/^(Preencha|Informe|Um ou mais|Envie|O total|O arquivo|Formulário|O servidor|Não foi possível)/.test(mensagem)) {
      return mensagem;
    }
    if (/failed to fetch|network|load failed/i.test(mensagem)) {
      return 'Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.';
    }
    if (/anonymous|authentication|jwt|session/i.test(mensagem)) {
      return 'Não foi possível validar a sessão. Atualize a página e tente novamente.';
    }
    if (/maximum 3|5 mb|attachment size/i.test(mensagem)) {
      return 'Envie no máximo 3 anexos, com até 5 MB no total.';
    }
    return 'Não foi possível enviar a solicitação. Tente novamente.';
  }

  async function enviarOrcamento(form) {
    var solicitacaoId = null;
    var enviados = [];

    try {
      if (!form || typeof global.FormData !== 'function') {
        throw new Error('Formulário inválido.');
      }
      var formData = form instanceof global.FormData ? form : new global.FormData(form);
      var campos = validarFormulario(formData);
      var arquivos = validarAnexos(formData);

      var captchaToken = obterCaptchaToken(formCaptchaWidget) || texto(formData, 'cf-turnstile-response');
      await garantirSessao(captchaToken);
      var criacao = await db.rpc('criar_rascunho', {
        p_nome: campos.nome,
        p_email: campos.email,
        p_telefone: campos.telefone || null,
        p_cidade: campos.cidade || null,
        p_endereco: campos.endereco || null,
        p_latitude: campos.latitude,
        p_longitude: campos.longitude,
        p_assunto: campos.assunto,
        p_mensagem: campos.mensagem
      });
      if (criacao.error) throw criacao.error;
      solicitacaoId = idSolicitacao(criacao.data);
      if (!solicitacaoId) throw new Error('O servidor não retornou o número da solicitação.');

      for (var i = 0; i < arquivos.length; i += 1) {
        var arquivo = arquivos[i];
        var reserva = await db.rpc('reservar_anexo', {
          p_solicitacao_id: solicitacaoId,
          p_nome_arquivo: arquivo.name,
          p_mime_type: tipoDoArquivo(arquivo),
          p_tamanho: arquivo.size
        });
        if (reserva.error) throw reserva.error;

        var caminho = caminhoReservado(reserva.data);
        if (!caminho) throw new Error('O servidor não retornou o caminho do anexo.');
        var upload = await db.storage.from(ANEXOS_BUCKET).upload(caminho, arquivo, {
          upsert: false,
          contentType: tipoDoArquivo(arquivo)
        });
        if (upload.error) throw upload.error;
        enviados.push(caminho);
      }

      var envio = await db.rpc('finalizar_solicitacao', { p_solicitacao_id: solicitacaoId });
      if (envio.error) throw envio.error;
      return {
        success: true,
        message: 'Recebemos sua solicitação! Entraremos em contato em breve.'
      };
    } catch (erro) {
      await desfazerEnvio(solicitacaoId, enviados);
      return { success: false, message: mensagemErro(erro) };
    }
  }

  async function obterContadores() {
    var resultado = await db.rpc('contadores_publicos');
    if (resultado.error) throw new Error(mensagemErro(resultado.error));
    return primeiroRegistro(resultado.data) || {};
  }

  async function obterImagensCards() {
    var resultado = await db.from('imagens').select('chave, storage_path');
    if (resultado.error) throw new Error(mensagemErro(resultado.error));

    return (resultado.data || []).reduce(function (imagens, item) {
      if (!item.chave || !item.storage_path) return imagens;
      var url = db.storage.from(IMAGENS_BUCKET).getPublicUrl(item.storage_path);
      imagens[item.chave] = url.data.publicUrl;
      return imagens;
    }, {});
  }

  global.SEGMAF = Object.freeze({
    db: db,
    enviarOrcamento: enviarOrcamento,
    obterContadores: obterContadores,
    obterImagensCards: obterImagensCards,
    garantirSessao: garantirSessao,
    validarFormulario: validarFormulario,
    validarAnexos: validarAnexos,
    tipoDoArquivo: tipoDoArquivo,
    mensagemErro: mensagemErro,
    SUPABASE_URL: SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: SUPABASE_PUBLISHABLE_KEY,
    ANEXOS_BUCKET: ANEXOS_BUCKET,
    IMAGENS_BUCKET: IMAGENS_BUCKET,
    TURNSTILE_SITE_KEY: TURNSTILE_SITE_KEY,
    renderizarCaptcha: renderizarCaptcha,
    obterCaptchaToken: obterCaptchaToken,
    resetarCaptcha: resetarCaptcha,
    MAX_ANEXOS: MAX_ANEXOS,
    MAX_TOTAL_BYTES: MAX_TOTAL_BYTES
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', prepararCaptchaFormulario, { once: true });
  } else {
    prepararCaptchaFormulario();
  }
})(window);
