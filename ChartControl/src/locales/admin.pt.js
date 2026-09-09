/* ============================================================
   Português (Brasil) — 관리자 화면 (pages-admin.jsx / pages-admin-more.jsx) 사전
   ------------------------------------------------------------
   키는 tools/i18n-extract.py 가 생성한 것이며 바꾸지 않는다. 값만 번역한다.
   ★ {tab} {n} {pending} 치환자는 그대로 남긴다.
   ★ 사람 이름은 표본 데이터다 — 번역하지 않는다. HTML 엔티티(&#10;)는 유지한다.
   ============================================================ */

(function () {
  'use strict';
  if (!window.QTI18n) return;

  window.QTI18n.register(
    'pt',
    {
      // --- 대시보드 / 목록 부제 ---
      admin_dashboard_0ccafd: 'Status da plataforma ao vivo · anomalias · risco · IA · sistema',
      admin_users_3fefdf: 'Buscar nome · e-mail · ID',
      admin_trades_bc077b: 'Ordens ao vivo · execuções · detecção de anomalias',
      admin_risk_a1edf2: 'Exposição de posições · fila de liquidação · risco de mercado',
      admin_fees_65feac: 'Níveis de taxa · rebates · promoções · payback',
      admin_notices_15d236: 'Comunicados',
      admin_notices_11300f: 'Publicar comunicados · gerenciar solicitações de clientes',

      // --- 사용자 상세 ---
      admin_user_detail_106e43: 'Buscar · filtrar · exportar CSV',
      admin_user_detail_170f7b: 'Cadastro em',
      admin_user_detail_22d6d2: 'Volume em 30 dias',
      admin_user_detail_33103c: 'Taxas acumuladas',
      admin_user_detail_3f4319: 'Documento de identidade',
      admin_user_detail_0057bd: 'Documentos de KYC',
      admin_user_detail_43a4e1: 'Registro de atividade',
      admin_user_detail_8f5d10: 'Registro de atividade · últimos 20 itens',
      admin_user_detail_8797eb: 'Histórico de operações',
      admin_user_detail_80a094: 'Histórico de negociação',
      admin_user_detail_81922a: 'Posições',
      admin_user_detail_40ce13: 'Ativos',
      admin_user_detail_e4ec3e: 'Ver ativos',
      admin_user_detail_a5e5da: 'Segurança',
      admin_user_detail_8dd7e4: 'Eventos de segurança',
      admin_user_detail_915cf6: 'Notas do operador',
      admin_user_detail_f35682: 'Nota do operador (registrada no log de auditoria)',
      admin_user_detail_12614e: 'Linha do tempo · visão agregada',
      admin_user_detail_d65b24: 'Calculado automaticamente',
      admin_user_detail_44650a: 'Outro',
      admin_user_detail_a43b70: 'Resultado da análise de KYC',
      admin_user_detail_a74a3f: 'Nova verificação de KYC necessária',
      admin_user_detail_851473: 'Solicitar KYC novamente',
      admin_user_detail_219da4: 'Promover para L3',
      admin_user_detail_afc528: 'Solicitar nova análise',
      admin_user_detail_a1d12d: 'Negociação anômala detectada',
      admin_user_detail_2d003e: 'Questão de AML/CTF',
      admin_user_detail_ca5360: 'Solicitação do usuário',
      admin_user_detail_63c279: 'Motivo',
      admin_user_detail_96330a: 'Mensagem',
      admin_user_detail_941ad1: 'Enviar e-mail',
      admin_user_detail_04f2aa: 'Enviar link de redefinição por e-mail',
      admin_user_detail_e03d2f: 'Redefinir 2FA',
      admin_user_detail_82d3e7: 'Suspender conta',
      admin_user_detail_94cd06: '⚠ Suspender conta',
      admin_user_detail_1d441e: 'Suspender',
      admin_user_detail_f63bf7: 'Reativar',
      admin_user_detail_ebe503: 'Tem certeza de que deseja suspender este usuário?',
      admin_user_detail_bd464c: 'Na suspensão, o usuário é notificado por e-mail automaticamente e a ação fica registrada no log de auditoria.',
      admin_user_detail_ff8aa0: 'Confirmar suspensão',
      admin_user_detail_19b2d1: 'Cancelar',
      admin_user_detail_4def42: 'Usuário suspenso (simulação)',
      admin_user_tab_data: 'Exibindo os dados de {tab} deste usuário',
      admin_users_subtitle: '{n} usuários no total · KYC · permissões · suspensão · auditoria',

      // --- KYC 심사 ---
      admin_k_y_c_queue_46072a: 'Análise de KYC',
      admin_k_y_c_queue_d167fe: 'Dohyun Kim',
      admin_kyc_sla: '{pending} pendentes · SLA 24h',
      flag_auto_detected: ' · detectado automaticamente · ',
      flag_investigate: 'investigar',

      // --- 입출금 승인 ---
      admin_deposits_e9e567: 'Aprovação de depósitos',
      admin_deposits_48f252: 'Fila de depósitos',
      admin_deposits_df0901: 'Depósitos on-chain · confirmações · análise de AML',
      admin_withdrawals_372dac: 'Aprovação de saques',
      admin_withdrawals_d336c8: 'Fila de saques',
      admin_withdrawals_4af6f5: '2FA concluído · solicitações de saque pendentes',

      // --- 지갑 / 자산 ---
      admin_assets_7c2e10: 'Carteiras · aprovação de depósitos e saques · movimentação de ativos',
      admin_assets_16f852: 'Saldo total das carteiras (hot / cold)',
      admin_assets_d52d75: 'Fila de aprovação de depósitos e saques',
      admin_assets_293d08: 'Movimentação de ativos · reconciliação (lote noturno)',
      admin_assets_657644: 'Filtro de alertas de AML',
      admin_assets_hi_fi_60cb06: 'Carteiras · movimentação de ativos · reconciliação',
      admin_assets_hi_fi_dc00b9: 'Carteira hot · por ativo',
      admin_assets_hi_fi_24e2e8: 'Carteira cold · por ativo',
      admin_assets_hi_fi_503c9d: 'Saque imediato disponível',
      admin_assets_hi_fi_4b4b97: 'Contra os saldos dos usuários',
      admin_assets_hi_fi_48aeb1: 'Solicitação de movimentação de ativos (hot → cold, cold → hot)',

      // --- AI Ops ---
      admin_a_i_ops_50ede2: '💡 A v1.4.2 melhora a taxa de acerto em 7 p.p. em relação à v1.3.9. Recomendo migrar todo o tráfego neste fim de semana.',
      admin_a_i_ops_ed2648: 'há 3 dias · Kuri Kwon',

      // --- 공지 에디터 ---
      admin_notice_editor_db8cc8: 'Escrever comunicado',
      admin_notice_editor_3d991a: 'Novo comunicado · Markdown suportado',
      admin_notice_editor_a2ee94: 'Título do comunicado',
      admin_notice_editor_c3d57e: 'Corpo (Markdown suportado)&#10;&#10;ex.:&#10;## Subtítulo&#10;Escreva o conteúdo…&#10;- Item 1&#10;- Item 2&#10;&#10;**negrito** · [link](url)',
      admin_notice_editor_a8e5c8: '(sem título)',
      admin_notice_editor_c4c626: '(sem conteúdo)',
      admin_notice_editor_0a94de: 'Opções de publicação',
      admin_notice_editor_189dd9: '📌 Fixar no topo',
      admin_notice_editor_a2fa30: 'Banner no app para todos os usuários',
      admin_notice_editor_41c60b: 'Exibir na página inicial',
      admin_notice_editor_492974: 'Notificação push',
      admin_notice_editor_61187b: 'Enviar e-mail',
      admin_notice_editor_11a5df: '(definido automaticamente na publicação)',
      admin_notice_editor_102c1f: 'Kuri Kwon',
      admin_notice_editor_7148d7: 'Publicar',

      // --- 전체 발송 (Broadcast) ---
      admin_broadcast_b7f563: 'Envio em massa no app · e-mail · push',
      admin_broadcast_f724cc: 'Escrever mensagem',
      admin_broadcast_078b3a: 'Assunto',
      admin_broadcast_a7bc1f: 'ex.: promoção de rebate de agosto',
      admin_broadcast_c67b87: 'Corpo',
      admin_broadcast_1a8f0f: 'Escreva o corpo. Markdown suportado (**negrito** · `código` · [link](url)).',
      admin_broadcast_90bbad: 'Público',
      admin_broadcast_95066f: 'Todos (1.242)',
      admin_broadcast_be1a1a: 'Apenas Pro/VIP (642)',
      admin_broadcast_1395f0: 'KYC L3 (312)',
      admin_broadcast_050529: 'Ativos em 7 dias (820)',
      admin_broadcast_9c1758: 'Filtro personalizado',
      admin_broadcast_7aeb7e: 'Canais',
      admin_broadcast_4c0460: 'Alcance estimado',
      admin_broadcast_140c08: 'Custo estimado:',
      admin_broadcast_626099: 'Enviar agora',
      admin_broadcast_1a911b: 'Agendar',
      admin_broadcast_265106: 'Agendar envio',
      admin_broadcast_e6f9c4: 'Salvar rascunho',
      admin_broadcast_f1f368: 'Enviados recentemente',
      admin_broadcast_743fe1: '📢 Aviso de manutenção programada (1.242)',
      admin_broadcast_63c075: '🎉 Promoção de agosto (1.242)',
      admin_broadcast_bc4cc1: '📄 Atualização dos termos de serviço (1.242)',
      admin_bc_recipients: 'destinatários · {n} canais',

      // --- CS 티켓 ---
      admin_c_s_ticket_5c8747: 'Detalhes do ticket',
      admin_c_s_ticket_5c50d9: 'Usuário',
      admin_c_s_ticket_65b9cf: 'Perfil do usuário',
      admin_c_s_ticket_00ecd1: 'Operações recentes',
      admin_c_s_ticket_c65f61: 'Conversa',
      admin_c_s_ticket_a6c22d: 'Escreva uma resposta…',
      admin_c_s_ticket_95bf7b: 'Enviar resposta',
      admin_c_s_ticket_3f0669: 'Salvar (interno)',
      admin_c_s_ticket_15e878: 'Ações rápidas',
      admin_c_s_ticket_efefae: 'Respostas prontas',
      admin_c_s_ticket_291781: 'Olá. Vamos verificar e retornar em breve. Obrigado pela paciência.',
      admin_c_s_ticket_5be08a: 'Alguns dos seus documentos de KYC foram digitalizados muito desfocados e precisam ser analisados novamente. Reenvie aqui: /kyc/resubmit',
      admin_c_s_ticket_165627: 'Sim, confirme por favor.',
      admin_c_s_ticket_e31e52: ' — Tenho uma dúvida sobre isso. Já são vários dias sem avanço e estou frustrado.',

      // --- Design Ops ---
      admin_design_ops_247f98: 'Tokens de UI · componentes · gestão de páginas · registrar novas páginas e componentes',
      admin_design_ops_127e5c: 'Criar e registrar novas páginas, componentes e diálogos',
      admin_design_ops_631818: 'Nova página',
      admin_design_ops_ad367e: 'Começar de um modelo',
      admin_design_ops_b31be6: 'Novo componente',
      admin_design_ops_376325: 'Adicionar ao catálogo de componentes',
      admin_design_ops_b1169b: 'Novo diálogo / modal',
      admin_design_ops_23188a: 'Copiar snippet do modal',
      admin_design_ops_454af0: 'Fluxo de trabalho · convenções',
      admin_design_ops_341930: 'Documento guia',
    },
    { label: 'Português (BR)', bcp47: 'pt-BR' },
  );
})();
