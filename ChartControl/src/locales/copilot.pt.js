/* ============================================================
   Português (Brasil) — AI Copilot 사전
   ------------------------------------------------------------
   ★ 마크다운 기호(**강조**, - 목록, \n\n)를 그대로 유지한다.
   ★ 치환자는 그대로 남긴다.
   ★★ ai_fu_* 에 매수·매도 권유 문구를 넣지 않는다. 투자자문 등록이 없다.
   ★ 브라질 숫자 표기: 천단위 '.', 소수점 ',' (68.120 / 1,1%)
   ============================================================ */

(function () {
  'use strict';
  if (!window.QTI18n) return;

  window.QTI18n.register(
    'pt',
    {
      // --- 사고(thinking) 단계 ---
      ai_think_collect: 'Coletando dados do gráfico · BTC/USDT 15m · 220 candles',
      ai_think_swinglow: 'Detectando fundos recentes (verificando divergência de RSI)',
      ai_think_trendcand: 'Dois ou mais fundos encontrados → calculando candidatas a linha de tendência',
      ai_think_mtf: 'Verificando alinhamento entre múltiplos tempos gráficos (15m / 1H / 4H)',
      ai_think_atr: 'Calculando a distância de entrada e de stop a partir do ATR',
      ai_think_rr: 'Simulando três candidatas otimizadas por R:R',
      ai_think_swings: 'Varrendo os principais topos e fundos',
      ai_think_volnodes: 'Extraindo as regiões de alto volume',
      ai_think_context: 'Lendo o contexto',

      // --- 시스템 / 환영 ---
      ai_ctx_loaded: 'Contexto carregado. {symbol} · {tf} · {bars} candles.',
      ai_ctx_loaded_ind: 'Contexto carregado. {symbol} · {tf} · {bars} candles · {n} indicador(es) ativo(s).',
      ai_welcome_beginner:
        'Olá, aqui é o Copilot da {brand}. Estou analisando o gráfico de **{symbol}**. '
        + 'Pergunte em linguagem simples e eu posso desenhar linhas de tendência, suportes e resistências direto no gráfico, '
        + 'e sugerir níveis de entrada, stop e alvo. Eu sou uma ferramenta — ordens reais só são enviadas após a sua aprovação final.',
      ai_welcome_pro:
        'Copilot pronto. Ativo: **{symbol}** · TF: **{tf}** · Último: **{price}** · Dados de {time}. '
        + 'Peça linhas de tendência, S/R, entrada/SL/TP, R:R.',

      // --- 툴 실행 결과 ---
      ai_tool_trendline: '📐 Linha de tendência preliminar adicionada ao gráfico · camada: AI Draft',
      ai_overlay_updated: '✏️ {fields} atualizado',
      ai_overlay_updated_partial: '✏️ {done} atualizado. Não foi possível alterar {skipped} — a cor e a espessura da linha são definidas pelo gráfico e não são ajustáveis.',
      ai_overlay_update_unsupported: 'Não consegui alterar {fields}. A cor e a espessura da linha são definidas pelo gráfico (rascunhos da IA são tracejados, suas linhas são contínuas) e não podem ser ajustadas aqui.',
      ai_drew_trendline: '📐 Desenhei uma linha de tendência de {from} até {to}',
      ai_drew_level: '📍 Desenhei um nível em {price}',
      ai_drew_support: '📍 Desenhei suporte em {price}',
      ai_drew_resistance: '📍 Desenhei resistência em {price}',
      ai_drew_entry_zone: '🎯 Desenhei a zona de entrada {lo} – {hi}',
      ai_drew_stop: '🛑 Desenhei a linha de stop em {price}',
      ai_drew_target: '🎯 Desenhei o alvo {n} em {price}',
      ai_drew_invalidation: '⚠ Desenhei o nível de invalidação em {price}',
      ai_drew_long_marker: '▲ Marquei long em {price}',
      ai_drew_short_marker: '▼ Marquei short em {price}',
      sv_plan_required: 'Salvar exige um plano pago',
      sv_name_label: 'Dê um nome a isto',
      sv_save: 'Salvar',
      ai_my_setup: '◉ MEU SETUP',
      ai_setup_checked: 'VERIFICADO',
      ai_setup_missing: 'Faltando',
      ai_setup_against: 'Evidências contra o seu setup',
      ai_setup_against_hint: 'Isto não é motivo para parar — é o que o seu setup precisa suportar.',
      ai_setup_drawn: '📊 Desenhei {n} no gráfico · {items}',
      ai_setup_nothing_drawn: 'Nada foi desenhado — o setup não tinha níveis utilizáveis.',
      ai_setup_no_entry: 'Este setup não tem preço de entrada, então não é possível preparar um rascunho.',
      toast_draft_failed: 'Não foi possível preparar o rascunho',
      ai_step_validating: 'Verificando a solicitação',
      ai_step_tool: 'Usando {name}',
      ai_tool_edited: '✍️ Sua edição foi aplicada · {detail}',
      ai_hint_drag: '📌 Arraste os círculos nas pontas da linha de tendência para ajustá-la. Suas edições aparecem na conversa.',
      ai_invalidation_note: '· o sinal é invalidado automaticamente quando esta condição ocorre',

      // --- 추세선 응답 ---
      ai_reply_trendline_beginner:
        'Aqui está o que encontrei. Desenhei uma linha de tendência de alta ligando os dois fundos mais recentes.\n\n'
        + '- **Validade**: válida enquanto se sustentar como suporte 3 ou mais vezes sem um novo fundo\n'
        + '- **Invalidação**: fechamento de 15m abaixo da linha\n'
        + '- **Observação**: uma linha de tendência é uma referência, não uma decisão. Confirme com outros indicadores.\n\n'
        + 'Se quiser, também posso adicionar níveis de suporte e resistência.',
      ai_reply_trendline_pro:
        'Linha de tendência traçada do fundo **A** ao **B**.\n\n'
        + '- Inclinação: +42,6 USDT / candle de 15m\n'
        + '- Toques: 3\n'
        + '- Invalidação: fechamento de 15m < linha\n'
        + '- Divergência de RSI: nenhuma observada\n'
        + '- Absorção no book perto da linha: BID 68.150 (+3,2 BTC)',

      // --- 시그널 응답 ---
      ai_reply_signal_beginner:
        'Análise concluída. Coloquei um **cenário de entrada em long** no card abaixo.\n\n'
        + '- **Zona de entrada**: entrar em partes entre 68.120 e 68.360\n'
        + '- **Stop**: sair imediatamente no rompimento de 67.480 (cerca de -1,1%)\n'
        + '- **Alvos**: três etapas (68.980 / 69.640 / 70.420)\n'
        + '- **Risco/retorno**: 1 : 2,8\n'
        + '- **Confiança**: 74% (algumas partes não são totalmente certas)\n'
        + '- **Observação**: esta é uma análise de IA e pode ser invalidada por movimentos bruscos do mercado.',
      ai_reply_signal_pro:
        'Setup de long pronto.\n\n'
        + '- Entrada: 68.120–68.360 (em partes)\n'
        + '- SL: 67.480 · R 1,1%\n'
        + '- TP: 68.980 / 69.640 / 70.420\n'
        + '- R:R 1 : 2,8 · confiança 74%\n'
        + '- Invalidação: fechamento de 15m < 67.480',

      // --- 일반 응답 ---
      ai_reply_general:
        'Pergunta detectada: "{text}".\n\nTente comandos como "desenhe uma linha de tendência", "proponha entrada/SL/TP" ou "encontre suporte e resistência".',

      // --- 퀵 칩 ---
      ai_chip_trendline: '🎯 Desenhar linha de tendência de alta',
      ai_chip_trendline_cmd: 'desenhe uma linha de tendência de alta a partir dos fundos recentes',
      ai_chip_signal: '📊 Cenário de entrada',
      ai_chip_signal_cmd: 'me ajude a marcar minha entrada, meu stop e meu alvo',
      ai_chip_sr: '📍 Encontrar suporte / resistência',
      ai_chip_sr_cmd: 'encontre suporte e resistência',
      ai_chip_fib: '📐 Fibonacci',
      ai_chip_rr: '🔀 Calculadora de R:R',

      // --- 입력창 / 라벨 ---
      ai_input_beginner: 'Como posso ajudar? ex.: desenhe uma linha de tendência',
      ai_input_pro: 'Digite um comando… (ex.: desenhar linha de tendência / rascunhar meu setup / encontrar S/R)',
      ai_reason_beginner: '💡 Por quê',
      ai_reason_pro: 'Motivo',

      // --- 후속 제안 칩 ---
      ai_fu_title: 'A seguir você pode perguntar',
      ai_fu_risk_open_position: '⚠ Verificar o risco da minha posição aberta',
      ai_fu_risk_open_position_q: 'Tenho uma posição aberta. Qual é a minha distância de liquidação e o que a invalidaria?',
      ai_fu_invalidation: '❓ Em que ponto eu estaria errado?',
      ai_fu_invalidation_q: 'Desenhei uma entrada e um stop, mas nenhum nível de invalidação. A partir de que ponto eu devo aceitar que esta ideia está errada?',
      ai_fu_no_stop: '🛑 Não tenho nível de stop',
      ai_fu_no_stop_q: 'Desenhei uma zona de entrada, mas nenhum nível de stop. Explique os níveis estruturais abaixo e acima dela.',
      ai_fu_open_orders: '📋 Revisar minhas ordens pendentes',
      ai_fu_open_orders_q: 'Tenho ordens pendentes. Elas continuam coerentes com a estrutura atual?',
      ai_fu_counter_case: '🔄 Defenda o cenário oposto',
      ai_fu_counter_case_q: 'Agora defenda o oposto do que você acabou de dizer. Qual é o argumento mais forte contra isso?',
      ai_fu_review_trades: '📖 Revisar minhas operações anteriores',
      ai_fu_review_trades_q: 'Revise minhas operações anteriores. Eu segui o meu próprio plano e onde eu me desviei?',
      ai_fu_higher_tf: '🔍 Verificar o tempo gráfico maior',
      ai_fu_higher_tf_q: 'O tempo gráfico maior concorda com esta leitura ou discorda?',
      ai_fu_add_indicator: '📈 Sugerir indicadores para este caso',
      ai_fu_add_indicator_q: 'Não há indicadores no meu gráfico. Quais seriam informativos aqui e quais são as limitações deles?',
      ai_fu_funding: '💰 O que o funding está mostrando?',
      ai_fu_funding_q: 'O que a taxa de funding diz sobre o posicionamento neste momento?',
      ai_fu_order_book: '📊 Ler o livro de ofertas',
      ai_fu_order_book_q: 'O que a profundidade do book mostra perto do preço atual?',
      ai_fu_explain_levels: '📍 Explicar os níveis principais',
      ai_fu_explain_levels_q: 'Explique os níveis principais de {symbol} e como você identificou cada um.',

      // --- 저장 / 알림 결과 ---
      ai_points_insufficient: 'Pontos insuficientes para salvar. Recarregue na página de Pontos.',
      ai_alert_no_price: 'Este sinal não tem preço de entrada, então não há sobre o que alertar.',
      ai_alert_created: 'Alerta definido em {price}. Você será avisado quando o preço chegar lá.',
      ai_alert_failed: 'Não foi possível definir o alerta. Nada foi salvo — tente novamente.',

      ai_layer_hide: 'Ocultar esta camada no gráfico',
      ai_layer_show: 'Mostrar esta camada no gráfico',
    },
    { label: 'Português (BR)', bcp47: 'pt-BR' },
  );
})();
