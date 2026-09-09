/* ============================================================
   Español (Latinoamérica) — AI Copilot 사전
   ------------------------------------------------------------
   ★ 마크다운 기호(**강조**, - 목록, \n\n)를 그대로 유지한다.
   ★ 치환자는 그대로 남긴다.
   ★★ ai_fu_* 에 매수·매도 권유 문구를 넣지 않는다. 투자자문 등록이 없다.
   ★ 중남미 숫자 표기: 천단위 '.', 소수점 ',' (68.120 / 1,1%)
   ============================================================ */

(function () {
  'use strict';
  if (!window.QTI18n) return;

  window.QTI18n.register(
    'es',
    {
      // --- 사고(thinking) 단계 ---
      ai_think_collect: 'Recopilando datos del gráfico · BTC/USDT 15m · 220 velas',
      ai_think_swinglow: 'Detectando mínimos recientes (revisando divergencia de RSI)',
      ai_think_trendcand: 'Se encontraron dos o más mínimos → calculando líneas de tendencia candidatas',
      ai_think_mtf: 'Revisando la alineación entre varias temporalidades (15m / 1H / 4H)',
      ai_think_atr: 'Calculando la distancia de entrada y de stop a partir del ATR',
      ai_think_rr: 'Simulando tres candidatas optimizadas por R:R',
      ai_think_swings: 'Recorriendo los máximos y mínimos principales',
      ai_think_volnodes: 'Extrayendo las zonas de alto volumen',
      ai_think_context: 'Leyendo el contexto',

      // --- 시스템 / 환영 ---
      ai_ctx_loaded: 'Contexto cargado. {symbol} · {tf} · {bars} velas.',
      ai_ctx_loaded_ind: 'Contexto cargado. {symbol} · {tf} · {bars} velas · {n} indicador(es) activo(s).',
      ai_welcome_beginner:
        'Hola, acá es el Copilot de {brand}. Estoy analizando el gráfico de **{symbol}**. '
        + 'Preguntame en lenguaje común y puedo dibujar líneas de tendencia, soportes y resistencias directo en el gráfico, '
        + 'y sugerir niveles de entrada, stop y objetivo. Soy una herramienta — las órdenes reales solo se envían después de tu aprobación final.',
      ai_welcome_pro:
        'Copilot listo. Símbolo: **{symbol}** · TF: **{tf}** · Último: **{price}** · Datos al {time}. '
        + 'Pedí líneas de tendencia, S/R, entrada/SL/TP, R:R.',

      // --- 툴 실행 결과 ---
      ai_tool_trendline: '📐 Línea de tendencia preliminar agregada al gráfico · capa: AI Draft',
      ai_overlay_updated: '✏️ Se actualizó {fields}',
      ai_overlay_updated_partial: '✏️ Se actualizó {done}. No se pudo cambiar {skipped} — el color y el grosor de la línea los define el gráfico y no son ajustables.',
      ai_overlay_update_unsupported: 'No pude cambiar {fields}. El color y el grosor de la línea los define el gráfico (los borradores de la IA son punteados, tus líneas son continuas) y no se pueden ajustar desde acá.',
      ai_drew_trendline: '📐 Dibujé una línea de tendencia de {from} a {to}',
      ai_drew_level: '📍 Dibujé un nivel en {price}',
      ai_drew_support: '📍 Dibujé soporte en {price}',
      ai_drew_resistance: '📍 Dibujé resistencia en {price}',
      ai_drew_entry_zone: '🎯 Dibujé la zona de entrada {lo} – {hi}',
      ai_drew_stop: '🛑 Dibujé la línea de stop en {price}',
      ai_drew_target: '🎯 Dibujé el objetivo {n} en {price}',
      ai_drew_invalidation: '⚠ Dibujé el nivel de invalidación en {price}',
      ai_drew_long_marker: '▲ Marqué long en {price}',
      ai_drew_short_marker: '▼ Marqué short en {price}',
      sv_plan_required: 'Guardar requiere un plan de pago',
      sv_name_label: 'Ponele un nombre a esto',
      sv_save: 'Guardar',
      ai_my_setup: '◉ MI SETUP',
      ai_setup_checked: 'VERIFICADO',
      ai_setup_missing: 'Falta',
      ai_setup_against: 'Evidencia en contra de tu setup',
      ai_setup_against_hint: 'Esto no es motivo para frenar — es lo que tu setup tiene que resistir.',
      ai_setup_drawn: '📊 Dibujé {n} en el gráfico · {items}',
      ai_setup_nothing_drawn: 'No se dibujó nada — el setup no tenía niveles utilizables.',
      ai_setup_no_entry: 'Este setup no tiene precio de entrada, así que no se puede preparar un borrador.',
      toast_draft_failed: 'No se pudo preparar el borrador',
      ai_step_validating: 'Revisando la solicitud',
      ai_step_tool: 'Usando {name}',
      ai_tool_edited: '✍️ Se aplicó tu edición · {detail}',
      ai_hint_drag: '📌 Arrastrá los círculos de los extremos de la línea de tendencia para ajustarla. Tus ediciones se reflejan en la conversación.',
      ai_invalidation_note: '· la señal se invalida automáticamente cuando ocurre esta condición',

      // --- 추세선 응답 ---
      ai_reply_trendline_beginner:
        'Esto es lo que encontré. Dibujé una línea de tendencia ascendente uniendo los dos mínimos más recientes.\n\n'
        + '- **Validez**: válida mientras se sostenga como soporte 3 veces o más sin un nuevo mínimo\n'
        + '- **Invalidación**: cierre de 15m por debajo de la línea\n'
        + '- **Nota**: una línea de tendencia es una referencia, no una decisión. Confirmalo con otros indicadores.\n\n'
        + 'Si querés, también puedo agregar niveles de soporte y resistencia.',
      ai_reply_trendline_pro:
        'Línea de tendencia trazada del mínimo **A** al **B**.\n\n'
        + '- Pendiente: +42,6 USDT / vela de 15m\n'
        + '- Toques: 3\n'
        + '- Invalidación: cierre de 15m < línea\n'
        + '- Divergencia de RSI: no se observa\n'
        + '- Absorción en el libro cerca de la línea: BID 68.150 (+3,2 BTC)',

      // --- 시그널 응답 ---
      ai_reply_signal_beginner:
        'Análisis terminado. Puse un **escenario de entrada en long** en la tarjeta de abajo.\n\n'
        + '- **Zona de entrada**: entrar por partes entre 68.120 y 68.360\n'
        + '- **Stop**: salir de inmediato si se rompe 67.480 (alrededor de -1,1%)\n'
        + '- **Objetivos**: tres etapas (68.980 / 69.640 / 70.420)\n'
        + '- **Riesgo/beneficio**: 1 : 2,8\n'
        + '- **Confianza**: 74% (algunas partes no son del todo seguras)\n'
        + '- **Nota**: este es un análisis de IA y puede invalidarse por movimientos bruscos del mercado.',
      ai_reply_signal_pro:
        'Setup de long listo.\n\n'
        + '- Entrada: 68.120–68.360 (por partes)\n'
        + '- SL: 67.480 · R 1,1%\n'
        + '- TP: 68.980 / 69.640 / 70.420\n'
        + '- R:R 1 : 2,8 · confianza 74%\n'
        + '- Invalidación: cierre de 15m < 67.480',

      // --- 일반 응답 ---
      ai_reply_general:
        'Pregunta detectada: "{text}".\n\nProbá comandos como "dibujá una línea de tendencia", "propone entrada/SL/TP" o "encontrá soporte y resistencia".',

      // --- 퀵 칩 ---
      ai_chip_trendline: '🎯 Dibujar línea de tendencia ascendente',
      ai_chip_trendline_cmd: 'dibujá una línea de tendencia ascendente desde los mínimos recientes',
      ai_chip_signal: '📊 Escenario de entrada',
      ai_chip_signal_cmd: 'ayudame a marcar mi entrada, mi stop y mi objetivo',
      ai_chip_sr: '📍 Encontrar soporte / resistencia',
      ai_chip_sr_cmd: 'encontrá soporte y resistencia',
      ai_chip_fib: '📐 Fibonacci',
      ai_chip_rr: '🔀 Calculadora de R:R',

      // --- 입력창 / 라벨 ---
      ai_input_beginner: '¿En qué te ayudo? ej.: dibujá una línea de tendencia',
      ai_input_pro: 'Escribí un comando… (ej.: dibujar línea de tendencia / borrador de mi setup / encontrar S/R)',
      ai_reason_beginner: '💡 Por qué',
      ai_reason_pro: 'Motivo',

      // --- 후속 제안 칩 ---
      ai_fu_title: 'Después podés preguntar',
      ai_fu_risk_open_position: '⚠ Revisar el riesgo de mi posición abierta',
      ai_fu_risk_open_position_q: 'Tengo una posición abierta. ¿Cuál es mi distancia de liquidación y qué la invalidaría?',
      ai_fu_invalidation: '❓ ¿En qué punto estaría equivocado?',
      ai_fu_invalidation_q: 'Dibujé una entrada y un stop, pero ningún nivel de invalidación. ¿A partir de qué punto debería aceptar que esta idea está equivocada?',
      ai_fu_no_stop: '🛑 No tengo nivel de stop',
      ai_fu_no_stop_q: 'Dibujé una zona de entrada, pero ningún nivel de stop. Explicá los niveles estructurales por debajo y por encima.',
      ai_fu_open_orders: '📋 Revisar mis órdenes pendientes',
      ai_fu_open_orders_q: 'Tengo órdenes pendientes. ¿Siguen siendo coherentes con la estructura actual?',
      ai_fu_counter_case: '🔄 Argumentá el caso opuesto',
      ai_fu_counter_case_q: 'Ahora argumentá lo opuesto de lo que acabás de decir. ¿Cuál es el argumento más fuerte en contra?',
      ai_fu_review_trades: '📖 Revisar mis operaciones anteriores',
      ai_fu_review_trades_q: 'Revisá mis operaciones anteriores. ¿Seguí mi propio plan y en qué punto me desvié?',
      ai_fu_higher_tf: '🔍 Revisar la temporalidad mayor',
      ai_fu_higher_tf_q: '¿La temporalidad mayor coincide con esta lectura o la contradice?',
      ai_fu_add_indicator: '📈 Sugerir indicadores para este caso',
      ai_fu_add_indicator_q: 'No hay indicadores en mi gráfico. ¿Cuáles serían informativos acá y cuáles son sus límites?',
      ai_fu_funding: '💰 ¿Qué está haciendo el funding?',
      ai_fu_funding_q: '¿Qué dice la tasa de funding sobre el posicionamiento en este momento?',
      ai_fu_order_book: '📊 Leer el libro de órdenes',
      ai_fu_order_book_q: '¿Qué muestra la profundidad del libro cerca del precio actual?',
      ai_fu_explain_levels: '📍 Explicar los niveles clave',
      ai_fu_explain_levels_q: 'Explicá los niveles clave de {symbol} y cómo identificaste cada uno.',

      // --- 저장 / 알림 결과 ---
      ai_points_insufficient: 'No hay puntos suficientes para guardar esto. Recargá en la página de Puntos.',
      ai_alert_no_price: 'Esta señal no tiene precio de entrada, así que no hay nada sobre lo que alertar.',
      ai_alert_created: 'Alerta configurada en {price}. Te vamos a avisar cuando el precio llegue.',
      ai_alert_failed: 'No se pudo configurar la alerta. No se guardó nada — intentá de nuevo.',

      ai_layer_hide: 'Ocultar esta capa en el gráfico',
      ai_layer_show: 'Mostrar esta capa en el gráfico',
    },
    { label: 'Español (LatAm)', bcp47: 'es-419' },
  );
})();
