(function () {
  'use strict';

  const ADMIN_EMAIL = 'segmaf@outlook.com';
  const ANEXOS_BUCKET = 'anexos';
  const IMAGENS_BUCKET = 'imagens-cards';
  const MAX_IMAGEM = 3 * 1024 * 1024;
  const TIPOS_IMAGEM = ['image/jpeg', 'image/png', 'image/webp'];
  const CARD_LABELS = {
    'limpeza-paineis-solares': 'Limpeza de Painéis Solares',
    'limpeza-pos-obras': 'Limpeza Pós Obras',
    'capina-quimica-usina-solar': 'Capina Química em Usinas Solares',
    'capina-corporativa': 'Capina Corporativa',
    'rocagem-usina-solar': 'Roçagem em Usinas Solares',
    'pulverizacao-area-irrigada': 'Pulverização em Áreas Irrigadas',
    'captura-de-abelhas': 'Captura de Abelhas',
    'limpeza-cercamento-aceiros': 'Limpeza de Cercamento e Aceiros'
  };
  const CARD_KEYS = Object.keys(CARD_LABELS);
  const GALERIA_FALLBACK = ['FTO01.jpg','FTO01_3.jpg','FTO11.jpg','FTO11_5.jpg','IMG_AEREA.jpg','Plcas01.jpg','Sol01.jpg','Sol02.jpg','WhatsApp Image 2026-08-06 at 15.11.26 (1).jpeg','WhatsApp Image 2026-08-06 at 15.11.27 (1).jpeg','WhatsApp Image 2026-08-06 at 15.11.27.jpeg','WhatsApp Image 2026-08-06 at 15.11.28 (1).jpeg','WhatsApp Image 2026-08-06 at 15.11.28 (2).jpeg','WhatsApp Image 2026-08-06 at 15.11.28.jpeg','WhatsApp Image 2026-08-06 at 15.11.29 (1).jpeg','WhatsApp Image 2026-08-06 at 15.11.29 (2).jpeg','WhatsApp Image 2026-08-06 at 15.11.29 (3).jpeg','WhatsApp Image 2026-08-06 at 15.11.29.jpeg','WhatsApp Image 2026-08-06 at 15.11.30 (1).jpeg','WhatsApp Image 2026-08-06 at 15.11.30 (2).jpeg','WhatsApp Image 2026-08-06 at 15.11.30.jpeg'];

  let client;
  let solicitacoes = [];
  let galeriaTimer = null;

  function el(id) {
    return document.getElementById(id);
  }

  function supabase() {
    if (client) return client;
    if (!window.SEGMAF) throw new Error('Cliente Supabase não configurado.');
    client = window.SEGMAF.db || window.SEGMAF.supabase || window.SEGMAF.client || window.SEGMAF;
    if (!client.auth || !client.from || !client.storage) {
      throw new Error('Cliente Supabase inválido.');
    }
    return client;
  }

  function esc(valor) {
    return String(valor == null ? '' : valor)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtData(iso) {
    if (!iso) return '—';
    const data = new Date(iso);
    if (Number.isNaN(data.getTime())) return '—';
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    }).format(data);
  }

  function mensagem(id, texto, tipo) {
    const alvo = el(id);
    if (!alvo) return;
    alvo.textContent = texto || '';
    alvo.className = 'mensagem' + (tipo ? ' ' + tipo : '') + (texto ? '' : ' hidden');
  }

  function erroTexto(error, padrao) {
    return error && (error.message || error.error_description) || padrao;
  }

  function falhaDeSessao(error) {
    return Boolean(error && (
      error.status === 401 || error.statusCode === 401 ||
      /jwt|session|token.*expired|not authenticated/i.test(error.message || '')
    ));
  }

  function mostrarPainel() {
    el('telaLogin').classList.add('hidden');
    el('telaPainel').classList.remove('hidden');
    mensagem('msgLogin', '');
  }

  function mostrarLogin(texto) {
    el('telaPainel').classList.add('hidden');
    el('telaLogin').classList.remove('hidden');
    if (texto) mensagem('msgLogin', texto, 'erro');
  }

  function sessaoAdmin(sessao) {
    return Boolean(sessao && sessao.user &&
      String(sessao.user.email || '').toLowerCase() === ADMIN_EMAIL &&
      !sessao.user.is_anonymous);
  }

  async function tratarErro(error, destino, padrao) {
    if (falhaDeSessao(error)) {
      try { await supabase().auth.signOut(); } catch (_) {}
      mostrarLogin('Sua sessão expirou. Entre novamente.');
      return;
    }
    mensagem(destino, erroTexto(error, padrao), 'erro');
  }

  function anexosDe(solicitacao) {
    return Array.isArray(solicitacao.anexos) ? solicitacao.anexos : [];
  }

  function renderizar(itens, total) {
    const tabela = el('tabela');
    el('totalBadge').textContent = String(total == null ? itens.length : total);
    if (!itens.length) {
      tabela.innerHTML = '<div class="vazio">Nenhuma solicitação recebida ainda.</div>';
      return;
    }

    const linhas = itens.map(function (s) {
      const telefone = String(s.telefone || '');
      const whatsapp = telefone.replace(/\D/g, '');
      const anexos = anexosDe(s).map(function (a) {
        const id = encodeURIComponent(String(a.id));
        const nome = a.nome_arquivo || a.nome || 'anexo';
        return '<br/><a href="#" onclick="baixarAnexo(\'' + id + '\');return false;" style="color:#F26522;font-size:.8rem">&#128206; ' + esc(nome) + '</a>';
      }).join('');
      const coordenadas = s.latitude != null && s.longitude != null
        ? '<br/><small>' + esc(s.latitude) + ', ' + esc(s.longitude) + '</small>' : '';
      return '<tr>' +
        '<td class="nome">' + esc(s.nome) + '</td>' +
        '<td>' + esc(s.email) + '<br/><span class="tag">' + esc(telefone || 'sem telefone') + '</span></td>' +
        '<td>' + esc(s.assunto) + '<br/><small>' + fmtData(s.criado_em) + '</small>' + anexos + '</td>' +
        '<td><span class="tag">' + esc(s.cidade || '—') + '</span><br/><small>' + esc(s.endereco || '') + '</small>' + coordenadas + '</td>' +
        '<td class="mensagem-texto">' + esc(s.mensagem) + '</td>' +
        '<td style="white-space:nowrap">' +
          '<label style="display:block;font-weight:600;font-size:.8rem;cursor:pointer;padding:2px 0"><input type="checkbox" onchange="marcar(' + Number(s.id) + ',\'lido\',this.checked)" ' + (s.lido ? 'checked' : '') + '> Lido</label>' +
          '<label style="display:block;font-weight:600;font-size:.8rem;cursor:pointer;padding:2px 0"><input type="checkbox" onchange="marcar(' + Number(s.id) + ',\'atendido\',this.checked)" ' + (s.atendido ? 'checked' : '') + '> Atendido</label>' +
        '</td>' +
        '<td><div class="acoes-linha">' +
          '<button class="btn-outline" onclick="abrirWhats(\'' + whatsapp + '\')">Whats</button>' +
          '<button class="btn-danger" onclick="excluir(' + Number(s.id) + ')">Excluir</button>' +
        '</div></td></tr>';
    }).join('');
    tabela.innerHTML = '<table><thead><tr><th>Nome</th><th>Contato</th><th>Assunto</th><th>Localização</th><th>Mensagem</th><th>Status</th><th>Ações</th></tr></thead><tbody>' + linhas + '</tbody></table>';
  }

  async function carregar() {
    mensagem('msgPainel', 'Carregando...');
    try {
      const todos = [];
      const pagina = 500;
      for (let inicio = 0; ; inicio += pagina) {
        const resposta = await supabase()
          .from('solicitacoes')
          .select('id, criado_em, nome, email, telefone, cidade, endereco, latitude, longitude, assunto, mensagem, lido, atendido, anexos (id, nome_arquivo, mime_type, tamanho, storage_path)')
          .eq('enviada', true)
          .order('criado_em', { ascending: false })
          .range(inicio, inicio + pagina - 1);
        if (resposta.error) throw resposta.error;
        todos.push(...(resposta.data || []));
        if (!resposta.data || resposta.data.length < pagina) break;
      }
      solicitacoes = todos;
      renderizar(solicitacoes, solicitacoes.length);
      mensagem('msgPainel', '');
    } catch (error) {
      await tratarErro(error, 'msgPainel', 'Erro ao carregar as solicitações.');
    }
  }

  async function entrar() {
    const senha = el('campoSenha').value;
    if (!senha) {
      mensagem('msgLogin', 'Digite a senha.', 'erro');
      return;
    }
    mensagem('msgLogin', 'Verificando...');
    try {
      const resposta = await supabase().auth.signInWithPassword({
        email: ADMIN_EMAIL,
        password: senha
      });
      if (resposta.error) throw resposta.error;
      el('campoSenha').value = '';
      mostrarPainel();
      await Promise.all([carregar(), carregarImagens()]);
    } catch (error) {
      mensagem('msgLogin', /invalid login/i.test(error.message || '') ? 'Senha incorreta.' : erroTexto(error, 'Não foi possível entrar.'), 'erro');
    }
  }

  async function sair() {
    try {
      const resposta = await supabase().auth.signOut();
      if (resposta.error) throw resposta.error;
      mostrarLogin();
    } catch (error) {
      mensagem('msgPainel', erroTexto(error, 'Não foi possível sair.'), 'erro');
    }
  }

  function abrirWhats(telefoneOuUrl) {
    const numeros = String(telefoneOuUrl || '').replace(/\D/g, '');
    if (!numeros) {
      mensagem('msgPainel', 'Esta solicitação não possui telefone.', 'erro');
      return;
    }
    const numero = numeros.startsWith('55') ? numeros : '55' + numeros;
    window.open('https://wa.me/' + numero, '_blank', 'noopener,noreferrer');
  }

  async function baixarAnexo(idCodificado) {
    mensagem('msgPainel', 'Preparando anexo...');
    try {
      const id = decodeURIComponent(String(idCodificado));
      let anexo;
      for (const s of solicitacoes) {
        anexo = anexosDe(s).find(function (a) { return String(a.id) === id; });
        if (anexo) break;
      }
      if (!anexo) {
        const resposta = await supabase().from('anexos').select('id, nome_arquivo, storage_path').eq('id', id).single();
        if (resposta.error) throw resposta.error;
        anexo = resposta.data;
      }
      const assinado = await supabase().storage.from(ANEXOS_BUCKET).createSignedUrl(anexo.storage_path, 60, {
        download: anexo.nome_arquivo
      });
      if (assinado.error) throw assinado.error;
      const respostaArquivo = await fetch(assinado.data.signedUrl);
      if (!respostaArquivo.ok) {
        const error = new Error('Não foi possível baixar o anexo.');
        error.status = respostaArquivo.status;
        throw error;
      }
      const url = URL.createObjectURL(await respostaArquivo.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = anexo.nome_arquivo || 'anexo';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      mensagem('msgPainel', '');
    } catch (error) {
      await tratarErro(error, 'msgPainel', 'Erro ao baixar o anexo.');
    }
  }

  async function marcar(id, campo, valor) {
    if (campo !== 'lido' && campo !== 'atendido') return;
    try {
      const alteracao = {};
      alteracao[campo] = Boolean(valor);
      const resposta = await supabase().from('solicitacoes').update(alteracao).eq('id', id).eq('enviada', true).select('id').single();
      if (resposta.error) throw resposta.error;
      const local = solicitacoes.find(function (s) { return Number(s.id) === Number(id); });
      if (local) local[campo] = Boolean(valor);
      mensagem('msgPainel', 'Status atualizado.', 'ok');
    } catch (error) {
      await tratarErro(error, 'msgPainel', 'Erro ao atualizar o status.');
      await carregar();
    }
  }

  async function excluir(id) {
    if (!window.confirm('Excluir esta solicitação e todos os anexos?')) return;
    mensagem('msgPainel', 'Excluindo solicitação...');
    try {
      let item = solicitacoes.find(function (s) { return Number(s.id) === Number(id); });
      if (!item) {
        const consulta = await supabase().from('solicitacoes').select('id, anexos (storage_path)').eq('id', id).eq('enviada', true).single();
        if (consulta.error) throw consulta.error;
        item = consulta.data;
      }
      const caminhos = anexosDe(item).map(function (a) { return a.storage_path; }).filter(Boolean);
      if (caminhos.length) {
        const remocao = await supabase().storage.from(ANEXOS_BUCKET).remove(caminhos);
        if (remocao.error) throw remocao.error;
      }
      const resposta = await supabase().from('solicitacoes').delete().eq('id', id).eq('enviada', true).select('id').single();
      if (resposta.error) throw resposta.error;
      await carregar();
      mensagem('msgPainel', 'Solicitação excluída.', 'ok');
    } catch (error) {
      await tratarErro(error, 'msgPainel', 'Erro ao excluir a solicitação.');
    }
  }

  function exportarCSV(itens) {
    const cabecalho = ['id','criado_em','nome','email','telefone','cidade','endereco','latitude','longitude','assunto','mensagem','lido','atendido','anexos'];
    const celula = function (valor) {
      let texto = String(valor == null ? '' : valor);
      if (/^[=+\-@]/.test(texto)) texto = "'" + texto;
      return '"' + texto.replace(/"/g, '""') + '"';
    };
    const linhas = (itens || solicitacoes).map(function (s) {
      const nomes = anexosDe(s).map(function (a) { return a.nome_arquivo || a.nome || ''; }).join(' | ');
      return [s.id,s.criado_em,s.nome,s.email,s.telefone,s.cidade,s.endereco,s.latitude,s.longitude,s.assunto,s.mensagem,s.lido,s.atendido,nomes]
        .map(celula).join(';');
    });
    const blob = new Blob(['\ufeff' + [cabecalho.join(';')].concat(linhas).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'solicitacoes-segmaf.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  async function recalcularAtendidos() {
    if (!window.confirm('Sincronizar o contador com as solicitações finalizadas marcadas como Atendido?')) return;
    try {
      const resposta = await supabase().rpc('admin_recalcular_atendidos');
      if (resposta.error) throw resposta.error;
      mensagem('msgPainel', 'Contador ajustado para ' + resposta.data + '.', 'ok');
    } catch (error) {
      await tratarErro(error, 'msgPainel', 'Erro ao ajustar o contador.');
    }
  }

  async function zerarAtendidos() {
    if (!window.confirm('Zerar o contador de orçamentos atendidos?')) return;
    try {
      const resposta = await supabase().rpc('admin_zerar_atendidos');
      if (resposta.error) throw resposta.error;
      mensagem('msgPainel', 'Contador zerado.', 'ok');
    } catch (error) {
      await tratarErro(error, 'msgPainel', 'Erro ao zerar o contador.');
    }
  }

  function publicUrl(caminho) {
    return supabase().storage.from(IMAGENS_BUCKET).getPublicUrl(caminho).data.publicUrl;
  }

  async function carregarImagens() {
    const grade = el('gradeImagens');
    grade.innerHTML = '<div class="vazio">Carregando imagens...</div>';
    mensagem('msgImagens', '');
    try {
      const resposta = await supabase().from('imagens').select('chave, storage_path, nome, mime, tamanho, atualizada_em').in('chave', CARD_KEYS);
      if (resposta.error) throw resposta.error;
      const porChave = new Map((resposta.data || []).map(function (imagem) { return [imagem.chave, imagem]; }));
      grade.innerHTML = CARD_KEYS.map(function (chave) {
        const imagem = porChave.get(chave) || { chave: chave };
        const custom = Boolean(imagem.storage_path);
        const src = custom ? publicUrl(imagem.storage_path) : chave + '.png';
        const origem = custom ? '<span class="verde">Personalizada</span>' : 'Padrão do site';
        const dataInfo = custom && imagem.atualizada_em ? ' · ' + fmtData(imagem.atualizada_em) : '';
        return '<div class="img-item">' +
          '<img src="' + esc(src) + '" alt="' + esc(CARD_LABELS[chave]) + '" loading="lazy" />' +
          '<div class="nome-img">' + esc(CARD_LABELS[chave]) + '</div>' +
          '<div class="info-img">' + origem + dataInfo + '</div>' +
          '<div class="acoes-img"><button class="btn-outline" onclick="enviarImagem(\'' + chave + '\')">Trocar imagem</button>' +
          (custom ? '<button class="btn-danger" onclick="restaurarImagem(\'' + chave + '\')">Restaurar padrão</button>' : '') + '</div>' +
          '<input type="file" accept="image/jpeg,image/png,image/webp" id="arquivo-' + chave + '" style="display:none" onchange="uploadImagem(\'' + chave + '\',this)" />' +
        '</div>';
      }).join('');
    } catch (error) {
      grade.innerHTML = '<div class="vazio">Não foi possível carregar as imagens.</div>';
      await tratarErro(error, 'msgImagens', 'Erro ao carregar as imagens.');
    }
  }

  function enviarImagem(chave) {
    if (!CARD_KEYS.includes(chave)) return;
    const input = el('arquivo-' + chave);
    if (input) input.click();
  }

  async function obterImagem(chave) {
    const resposta = await supabase().from('imagens').select('chave, storage_path, nome, mime, tamanho').eq('chave', chave).maybeSingle();
    if (resposta.error) throw resposta.error;
    return resposta.data || { chave: chave, storage_path: null };
  }

  async function backupObjeto(imagem) {
    if (!imagem.storage_path) return null;
    try {
      const resposta = await fetch(publicUrl(imagem.storage_path));
      return resposta.ok ? await resposta.blob() : null;
    } catch (_) {
      return null;
    }
  }

  async function uploadImagem(chave, input) {
    const arquivo = input && input.files && input.files[0];
    if (!arquivo || !CARD_KEYS.includes(chave)) return;
    if (!TIPOS_IMAGEM.includes(arquivo.type)) {
      mensagem('msgImagens', 'Envie uma imagem JPEG, PNG ou WebP.', 'erro');
      input.value = '';
      return;
    }
    if (arquivo.size > MAX_IMAGEM) {
      mensagem('msgImagens', 'A imagem precisa ter até 3 MB.', 'erro');
      input.value = '';
      return;
    }

    mensagem('msgImagens', 'Enviando imagem...');
    let novoCaminho = null;
    let antiga = null;
    let backup = null;
    try {
      antiga = await obterImagem(chave);
      backup = await backupObjeto(antiga);
      const extensao = arquivo.type === 'image/jpeg' ? 'jpg' : arquivo.type.split('/')[1];
      novoCaminho = chave + '/' + Date.now() + '.' + extensao;
      const envio = await supabase().storage.from(IMAGENS_BUCKET).upload(novoCaminho, arquivo, {
        contentType: arquivo.type,
        cacheControl: '31536000',
        upsert: false
      });
      if (envio.error) throw envio.error;

      if (antiga.storage_path && antiga.storage_path !== novoCaminho) {
        const remocao = await supabase().storage.from(IMAGENS_BUCKET).remove([antiga.storage_path]);
        if (remocao.error) throw remocao.error;
      }

      const metadados = await supabase().from('imagens').upsert({
        chave: chave,
        storage_path: novoCaminho,
        nome: arquivo.name,
        mime: arquivo.type,
        tamanho: arquivo.size
      }, { onConflict: 'chave' });
      if (metadados.error) throw metadados.error;
      mensagem('msgImagens', 'Imagem atualizada.', 'ok');
      await carregarImagens();
    } catch (error) {
      if (novoCaminho) await supabase().storage.from(IMAGENS_BUCKET).remove([novoCaminho]);
      if (antiga && antiga.storage_path && backup) {
        await supabase().storage.from(IMAGENS_BUCKET).upload(antiga.storage_path, backup, {
          contentType: antiga.mime || backup.type,
          cacheControl: '31536000',
          upsert: true
        });
      }
      await tratarErro(error, 'msgImagens', 'Erro ao enviar a imagem.');
    } finally {
      input.value = '';
    }
  }

  async function restaurarImagem(chave) {
    if (!CARD_KEYS.includes(chave) || !window.confirm('Restaurar a imagem padrão do site?')) return;
    mensagem('msgImagens', 'Restaurando imagem padrão...');
    let antiga;
    let backup;
    try {
      antiga = await obterImagem(chave);
      backup = await backupObjeto(antiga);
      if (antiga.storage_path) {
        const remocao = await supabase().storage.from(IMAGENS_BUCKET).remove([antiga.storage_path]);
        if (remocao.error) throw remocao.error;
      }
      const metadados = await supabase().from('imagens').upsert({
        chave: chave, storage_path: null, nome: null, mime: null, tamanho: null
      }, { onConflict: 'chave' });
      if (metadados.error) throw metadados.error;
      mensagem('msgImagens', 'Imagem padrão restaurada.', 'ok');
      await carregarImagens();
    } catch (error) {
      if (antiga && antiga.storage_path && backup) {
        await supabase().storage.from(IMAGENS_BUCKET).upload(antiga.storage_path, backup, {
          contentType: antiga.mime || backup.type,
          cacheControl: '31536000',
          upsert: true
        });
      }
      await tratarErro(error, 'msgImagens', 'Erro ao restaurar a imagem.');
    }
  }

  async function carregarFotosGaleria() {
    try {
      const resposta = await fetch('https://api.github.com/repos/geocria-gif/segmaf/contents/Galeria', {
        headers: { Accept: 'application/vnd.github+json' }
      });
      if (!resposta.ok) throw new Error('GitHub API ' + resposta.status);
      const dados = await resposta.json();
      const fotos = Array.isArray(dados) ? dados
        .filter(function (item) { return item.type === 'file' && /\.(jpe?g|png|webp|gif)$/i.test(item.name); })
        .map(function (item) { return item.name; }) : [];
      return fotos.length ? fotos : GALERIA_FALLBACK.slice();
    } catch (_) {
      return GALERIA_FALLBACK.slice();
    }
  }

  function abrirLightbox(src) {
    el('lbImagem').src = src;
    el('lightbox').classList.add('aberto');
  }

  function fecharLightbox() {
    el('lightbox').classList.remove('aberto');
    el('lbImagem').removeAttribute('src');
  }

  async function iniciarGaleria() {
    const fotos = await carregarFotosGaleria();
    const track = el('trackGaleria');
    const dots = el('dotsGaleria');
    const contador = el('contadorGaleria');
    let indice = 0;
    if (!fotos.length) {
      track.innerHTML = '<div class="carrossel-slide"><div style="color:#fff;text-align:center;padding:40px">Nenhuma foto na pasta Galeria.</div></div>';
      return;
    }
    track.innerHTML = fotos.map(function (nome) {
      const src = 'Galeria/' + encodeURIComponent(nome);
      return '<div class="carrossel-slide"><img src="' + esc(src) + '" alt="' + esc(nome) + '" loading="lazy" /></div>';
    }).join('');
    dots.innerHTML = fotos.map(function (nome, i) {
      return '<button class="dot" data-i="' + i + '" title="' + esc(nome) + '"></button>';
    }).join('');

    function irPara(i) {
      indice = (i + fotos.length) % fotos.length;
      track.style.transform = 'translateX(-' + (indice * 100) + '%)';
      dots.querySelectorAll('.dot').forEach(function (dot, j) { dot.classList.toggle('ativo', j === indice); });
      contador.textContent = (indice + 1) + ' / ' + fotos.length;
    }
    function reiniciar() {
      clearInterval(galeriaTimer);
      galeriaTimer = setInterval(function () { irPara(indice + 1); }, 3500);
    }
    el('btnAnt').onclick = function () { irPara(indice - 1); reiniciar(); };
    el('btnProx').onclick = function () { irPara(indice + 1); reiniciar(); };
    dots.onclick = function (evento) {
      const dot = evento.target.closest('.dot');
      if (dot) { irPara(Number(dot.dataset.i)); reiniciar(); }
    };
    track.onclick = function (evento) {
      if (evento.target.tagName === 'IMG') abrirLightbox(evento.target.src);
    };
    irPara(0);
    reiniciar();
  }

  function capturarClique(id, acao) {
    el(id).addEventListener('click', function (evento) {
      evento.preventDefault();
      evento.stopImmediatePropagation();
      acao();
    }, true);
  }

  async function iniciarAdmin() {
    try {
      capturarClique('btnEntrar', entrar);
      capturarClique('btnAtualizar', carregar);
      capturarClique('btnAjustar', recalcularAtendidos);
      capturarClique('btnZerar', zerarAtendidos);
      capturarClique('btnExportar', function () { exportarCSV(solicitacoes); });
      capturarClique('btnSair', sair);
      el('campoSenha').addEventListener('keydown', function (evento) {
        if (evento.key === 'Enter') {
          evento.preventDefault();
          evento.stopImmediatePropagation();
          entrar();
        }
      }, true);
      el('lbFechar').onclick = fecharLightbox;
      el('lightbox').onclick = function (evento) { if (evento.target === el('lightbox')) fecharLightbox(); };
      document.addEventListener('keydown', function (evento) { if (evento.key === 'Escape') fecharLightbox(); });

      iniciarGaleria();
      const sessao = await supabase().auth.getSession();
      if (sessao.error) throw sessao.error;
      if (sessaoAdmin(sessao.data.session)) {
        mostrarPainel();
        await Promise.all([carregar(), carregarImagens()]);
      } else {
        mostrarLogin();
      }
      supabase().auth.onAuthStateChange(function (evento, sessaoAtual) {
        if (evento === 'SIGNED_OUT' || !sessaoAdmin(sessaoAtual)) mostrarLogin();
      });
    } catch (error) {
      mostrarLogin(erroTexto(error, 'Não foi possível iniciar o painel.'));
    }
  }

  Object.assign(window, {
    mostrarPainel: mostrarPainel,
    mostrarLogin: mostrarLogin,
    carregar: carregar,
    renderizar: renderizar,
    fmtData: fmtData,
    esc: esc,
    abrirWhats: abrirWhats,
    baixarAnexo: baixarAnexo,
    marcar: marcar,
    excluir: excluir,
    exportarCSV: exportarCSV,
    carregarImagens: carregarImagens,
    enviarImagem: enviarImagem,
    uploadImagem: uploadImagem,
    restaurarImagem: restaurarImagem,
    carregarFotosGaleria: carregarFotosGaleria,
    abrirLightbox: abrirLightbox,
    entrar: entrar,
    sair: sair,
    recalcularAtendidos: recalcularAtendidos,
    zerarAtendidos: zerarAtendidos
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciarAdmin, { once: true });
  } else {
    iniciarAdmin();
  }
})();
