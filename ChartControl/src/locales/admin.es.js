/* ============================================================
   Español (Latinoamérica) — 관리자 화면 (pages-admin.jsx / pages-admin-more.jsx) 사전
   ------------------------------------------------------------
   키는 tools/i18n-extract.py 가 생성한 것이며 바꾸지 않는다. 값만 번역한다.
   ★ {tab} {n} {pending} 치환자는 그대로 남긴다.
   ★ 사람 이름은 표본 데이터다 — 번역하지 않는다. HTML 엔티티(&#10;)는 유지한다.
   ============================================================ */

(function () {
  'use strict';
  if (!window.QTI18n) return;

  window.QTI18n.register(
    'es',
    {
      // --- 대시보드 / 목록 부제 ---
      admin_dashboard_0ccafd: 'Estado de la plataforma en vivo · anomalías · riesgo · IA · sistema',
      admin_users_3fefdf: 'Buscar nombre · correo · ID',
      admin_trades_bc077b: 'Órdenes en vivo · ejecuciones · detección de anomalías',
      admin_risk_a1edf2: 'Exposición de posiciones · cola de liquidación · riesgo de mercado',
      admin_fees_65feac: 'Niveles de comisión · rebates · promociones · payback',
      admin_notices_15d236: 'Anuncios',
      admin_notices_11300f: 'Publicar anuncios · gestionar consultas de clientes',

      // --- 사용자 상세 ---
      admin_user_detail_106e43: 'Buscar · filtrar · exportar CSV',
      admin_user_detail_170f7b: 'Se registró',
      admin_user_detail_22d6d2: 'Volumen de 30 días',
      admin_user_detail_33103c: 'Comisiones acumuladas',
      admin_user_detail_3f4319: 'Documento de identidad',
      admin_user_detail_0057bd: 'Documentos de KYC',
      admin_user_detail_43a4e1: 'Registro de actividad',
      admin_user_detail_8f5d10: 'Registro de actividad · últimas 20 entradas',
      admin_user_detail_8797eb: 'Historial de operaciones',
      admin_user_detail_80a094: 'Historial de negociación',
      admin_user_detail_81922a: 'Posiciones',
      admin_user_detail_40ce13: 'Activos',
      admin_user_detail_e4ec3e: 'Ver activos',
      admin_user_detail_a5e5da: 'Seguridad',
      admin_user_detail_8dd7e4: 'Eventos de seguridad',
      admin_user_detail_915cf6: 'Notas del operador',
      admin_user_detail_f35682: 'Nota del operador (queda en el log de auditoría)',
      admin_user_detail_12614e: 'Línea de tiempo · vista agregada',
      admin_user_detail_d65b24: 'Calculado automáticamente',
      admin_user_detail_44650a: 'Otro',
      admin_user_detail_a43b70: 'Resultado de la revisión de KYC',
      admin_user_detail_a74a3f: 'Se requiere nueva verificación de KYC',
      admin_user_detail_851473: 'Solicitar KYC de nuevo',
      admin_user_detail_219da4: 'Promover a L3',
      admin_user_detail_afc528: 'Solicitar nueva revisión',
      admin_user_detail_a1d12d: 'Se detectó operación anómala',
      admin_user_detail_2d003e: 'Asunto de AML/CTF',
      admin_user_detail_ca5360: 'Solicitud del usuario',
      admin_user_detail_63c279: 'Motivo',
      admin_user_detail_96330a: 'Mensaje',
      admin_user_detail_941ad1: 'Enviar correo',
      admin_user_detail_04f2aa: 'Enviar enlace de restablecimiento por correo',
      admin_user_detail_e03d2f: 'Restablecer 2FA',
      admin_user_detail_82d3e7: 'Suspender cuenta',
      admin_user_detail_94cd06: '⚠ Suspender cuenta',
      admin_user_detail_1d441e: 'Suspender',
      admin_user_detail_f63bf7: 'Quitar suspensión',
      admin_user_detail_ebe503: '¿Seguro que querés suspender a este usuario?',
      admin_user_detail_bd464c: 'Al suspender, se notifica al usuario por correo de forma automática y la acción queda registrada en el log de auditoría.',
      admin_user_detail_ff8aa0: 'Confirmar suspensión',
      admin_user_detail_19b2d1: 'Cancelar',
      admin_user_detail_4def42: 'Usuario suspendido (simulación)',
      admin_user_tab_data: 'Mostrando los datos de {tab} de este usuario',
      admin_users_subtitle: '{n} usuarios en total · KYC · permisos · suspensión · auditoría',

      // --- KYC 심사 ---
      admin_k_y_c_queue_46072a: 'Revisión de KYC',
      admin_k_y_c_queue_d167fe: 'Dohyun Kim',
      admin_kyc_sla: '{pending} pendientes · SLA 24 h',
      flag_auto_detected: ' · detectado automáticamente · ',
      flag_investigate: 'investigar',

      // --- 입출금 승인 ---
      admin_deposits_e9e567: 'Aprobación de depósitos',
      admin_deposits_48f252: 'Cola de depósitos',
      admin_deposits_df0901: 'Depósitos on-chain · confirmaciones · revisión de AML',
      admin_withdrawals_372dac: 'Aprobación de retiros',
      admin_withdrawals_d336c8: 'Cola de retiros',
      admin_withdrawals_4af6f5: '2FA completo · solicitudes de retiro pendientes',

      // --- 지갑 / 자산 ---
      admin_assets_7c2e10: 'Billeteras · aprobación de depósitos y retiros · movimiento de activos',
      admin_assets_16f852: 'Saldo total de billeteras (hot / cold)',
      admin_assets_d52d75: 'Cola de aprobación de depósitos y retiros',
      admin_assets_293d08: 'Movimiento de activos · conciliación (lote nocturno)',
      admin_assets_657644: 'Filtro de alertas de AML',
      admin_assets_hi_fi_60cb06: 'Billeteras · movimiento de activos · conciliación',
      admin_assets_hi_fi_dc00b9: 'Billetera hot · por activo',
      admin_assets_hi_fi_24e2e8: 'Billetera cold · por activo',
      admin_assets_hi_fi_503c9d: 'Retirable al instante',
      admin_assets_hi_fi_4b4b97: 'Contra los saldos de los usuarios',
      admin_assets_hi_fi_48aeb1: 'Solicitud de movimiento de activos (hot → cold, cold → hot)',

      // --- AI Ops ---
      admin_a_i_ops_50ede2: '💡 La v1.4.2 mejora la tasa de acierto en 7 p.p. respecto a la v1.3.9. Se recomienda migrar todo el tráfico este fin de semana.',
      admin_a_i_ops_ed2648: 'hace 3 días · Kuri Kwon',

      // --- 공지 에디터 ---
      admin_notice_editor_db8cc8: 'Redactar anuncio',
      admin_notice_editor_3d991a: 'Anuncio nuevo · admite Markdown',
      admin_notice_editor_a2ee94: 'Título del anuncio',
      admin_notice_editor_c3d57e: 'Cuerpo (admite Markdown)&#10;&#10;ej.:&#10;## Subtítulo&#10;Escribí el contenido…&#10;- Ítem 1&#10;- Ítem 2&#10;&#10;**negrita** · [enlace](url)',
      admin_notice_editor_a8e5c8: '(sin título)',
      admin_notice_editor_c4c626: '(sin contenido)',
      admin_notice_editor_0a94de: 'Opciones de publicación',
      admin_notice_editor_189dd9: '📌 Fijar arriba',
      admin_notice_editor_a2fa30: 'Banner en la app para todos los usuarios',
      admin_notice_editor_41c60b: 'Mostrar en la página de inicio',
      admin_notice_editor_492974: 'Notificación push',
      admin_notice_editor_61187b: 'Enviar correo',
      admin_notice_editor_11a5df: '(se define automáticamente al publicar)',
      admin_notice_editor_102c1f: 'Kuri Kwon',
      admin_notice_editor_7148d7: 'Publicar',

      // --- 전체 발송 (Broadcast) ---
      admin_broadcast_b7f563: 'Envío masivo en la app · correo · push',
      admin_broadcast_f724cc: 'Redactar mensaje',
      admin_broadcast_078b3a: 'Asunto',
      admin_broadcast_a7bc1f: 'ej.: promoción de rebate de agosto',
      admin_broadcast_c67b87: 'Cuerpo',
      admin_broadcast_1a8f0f: 'Escribí el cuerpo. Admite Markdown (**negrita** · `código` · [enlace](url)).',
      admin_broadcast_90bbad: 'Audiencia',
      admin_broadcast_95066f: 'Todos (1.242)',
      admin_broadcast_be1a1a: 'Solo Pro/VIP (642)',
      admin_broadcast_1395f0: 'KYC L3 (312)',
      admin_broadcast_050529: 'Activos en 7 días (820)',
      admin_broadcast_9c1758: 'Filtro personalizado',
      admin_broadcast_7aeb7e: 'Canales',
      admin_broadcast_4c0460: 'Alcance estimado',
      admin_broadcast_140c08: 'Costo estimado:',
      admin_broadcast_626099: 'Enviar ahora',
      admin_broadcast_1a911b: 'Programar',
      admin_broadcast_265106: 'Programar el envío',
      admin_broadcast_e6f9c4: 'Guardar borrador',
      admin_broadcast_f1f368: 'Enviados recientemente',
      admin_broadcast_743fe1: '📢 Aviso de mantenimiento programado (1.242)',
      admin_broadcast_63c075: '🎉 Promoción de agosto (1.242)',
      admin_broadcast_bc4cc1: '📄 Actualización de los términos del servicio (1.242)',
      admin_bc_recipients: 'destinatarios · {n} canales',

      // --- CS 티켓 ---
      admin_c_s_ticket_5c8747: 'Detalle del ticket',
      admin_c_s_ticket_5c50d9: 'Usuario',
      admin_c_s_ticket_65b9cf: 'Perfil del usuario',
      admin_c_s_ticket_00ecd1: 'Operaciones recientes',
      admin_c_s_ticket_c65f61: 'Conversación',
      admin_c_s_ticket_a6c22d: 'Escribí una respuesta…',
      admin_c_s_ticket_95bf7b: 'Enviar respuesta',
      admin_c_s_ticket_3f0669: 'Guardar (interno)',
      admin_c_s_ticket_15e878: 'Acciones rápidas',
      admin_c_s_ticket_efefae: 'Respuestas predefinidas',
      admin_c_s_ticket_291781: 'Hola. Lo vamos a revisar y te respondemos en breve. Gracias por esperar.',
      admin_c_s_ticket_5be08a: 'Algunos de tus documentos de KYC quedaron escaneados muy borrosos y hay que revisarlos de nuevo. Reenvialos acá: /kyc/resubmit',
      admin_c_s_ticket_165627: 'Sí, confirmá por favor.',
      admin_c_s_ticket_e31e52: ' — Tengo una consulta sobre esto. Pasaron varios días sin avance y estoy molesto.',

      // --- Design Ops ---
      admin_design_ops_247f98: 'Tokens de UI · componentes · gestión de páginas · registrar páginas y componentes nuevos',
      admin_design_ops_127e5c: 'Crear y registrar páginas, componentes y diálogos nuevos',
      admin_design_ops_631818: 'Página nueva',
      admin_design_ops_ad367e: 'Empezar desde una plantilla',
      admin_design_ops_b31be6: 'Componente nuevo',
      admin_design_ops_376325: 'Agregar al catálogo de componentes',
      admin_design_ops_b1169b: 'Diálogo / modal nuevo',
      admin_design_ops_23188a: 'Copiar el snippet del modal',
      admin_design_ops_454af0: 'Flujo de trabajo · convenciones',
      admin_design_ops_341930: 'Documento guía',
    },
    { label: 'Español (LatAm)', bcp47: 'es-419' },
  );
})();
