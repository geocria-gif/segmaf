(function(){
  'use strict';
  const CAMPOS={
    nome:{label:'Nome completo',placeholder:'Como podemos chamar você?',required:true,autocomplete:'name'},
    email:{label:'E-mail profissional',placeholder:'voce@empresa.com.br',required:true,autocomplete:'email'},
    telefone:{label:'Telefone / WhatsApp',placeholder:'(74) 99999-9999',autocomplete:'tel',inputmode:'tel'},
    cidade:{label:'Cidade',placeholder:'Cidade do empreendimento',autocomplete:'address-level2'},
    endereco:{label:'Endereço do empreendimento',placeholder:'Rua, número, bairro ou referência',full:true,autocomplete:'street-address'},
    latitude:{label:'Latitude',placeholder:'Preenchida pelo mapa',help:'Opcional. Use o mapa da página inicial para maior precisão.'},
    longitude:{label:'Longitude',placeholder:'Preenchida pelo mapa',help:'Opcional. Use o mapa da página inicial para maior precisão.'},
    assunto:{label:'Serviço de interesse',required:true,full:true},
    mensagem:{label:'Detalhes da solicitação',placeholder:'Conte o tipo de área, tamanho aproximado, localização e prazo desejado.',required:true,full:true}
  };

  function melhorarFormulario(){
    const form=document.getElementById('contactForm');
    if(!form||form.classList.contains('form-profissional'))return;
    form.classList.add('form-profissional');

    const cabecalho=document.createElement('div');
    cabecalho.className='form-heading';
    cabecalho.innerHTML='<strong>Dados para o orçamento</strong><span>Preencha as informações abaixo. Os campos com * são obrigatórios.</span>';
    form.prepend(cabecalho);

    Object.keys(CAMPOS).forEach(nome=>{
      const campo=form.querySelector('[name="'+nome+'"]');
      if(!campo)return;
      const cfg=CAMPOS[nome];
      const id=campo.id||('form-'+nome);
      campo.id=id;
      if(cfg.placeholder&&campo.tagName!=='SELECT')campo.placeholder=cfg.placeholder;
      if(cfg.autocomplete)campo.autocomplete=cfg.autocomplete;
      if(cfg.inputmode)campo.inputMode=cfg.inputmode;
      const wrapper=document.createElement('div');
      wrapper.className='form-field'+(cfg.full?' form-field--full':'');
      const label=document.createElement('label');
      label.htmlFor=id;
      label.innerHTML=cfg.label+(cfg.required?' <span class="required" aria-hidden="true">*</span>':'');
      campo.parentNode.insertBefore(wrapper,campo);
      wrapper.appendChild(label);
      wrapper.appendChild(campo);
      if(cfg.help){
        const small=document.createElement('small');
        small.id=id+'-help';
        small.textContent=cfg.help;
        campo.setAttribute('aria-describedby',small.id);
        wrapper.appendChild(small);
      }
    });

    const upload=form.querySelector('.file-label');
    if(upload){
      upload.classList.add('form-upload');
      Array.from(upload.childNodes).filter(no=>no.nodeType===Node.TEXT_NODE).forEach(no=>no.remove());
      const titulo=document.createElement('div');
      titulo.className='upload-title';
      titulo.innerHTML='<span aria-hidden="true">&#128206;</span> Anexos do projeto';
      const ajuda=document.createElement('div');
      ajuda.className='upload-help';
      ajuda.textContent='Envie até 3 imagens ou arquivos PDF, total máximo de 5 MB.';
      upload.prepend(ajuda);
      upload.prepend(titulo);
    }
    const seguranca=document.createElement('div');
    seguranca.className='form-security';
    seguranca.textContent='Seus dados são protegidos por Supabase e Cloudflare Turnstile.';
    const botao=form.querySelector('button[type="submit"]');
    form.insertBefore(seguranca,botao||null);
    const msg=document.getElementById('formMsg');
    if(msg){msg.setAttribute('role','status');msg.setAttribute('aria-live','polite');}
    if(msg&&botao)botao.insertAdjacentElement('afterend',msg);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',melhorarFormulario,{once:true});
  else melhorarFormulario();
})();
