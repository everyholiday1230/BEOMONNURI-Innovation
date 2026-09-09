/* ============================================================
   Español (Latinoamérica) — 인증 화면 (pages-auth.jsx) 사전
   ------------------------------------------------------------
   대상: 멕시코·아르헨티나 등 중남미. 유럽 스페인어(es-ES) 표현을 쓰지 않는다.
   예) 'ordenador'(ES) 대신 'computadora', 'móvil' 대신 'celular'.

   키는 tools/i18n-extract.py 가 생성한 것이며 바꾸지 않는다. 값만 번역한다.
   ★ {brand} {step} {total} {email} 치환자는 그대로 남긴다.
   ★ 투자 성과·수익을 암시하는 표현을 넣지 않는다. 원문의 면책 톤 유지.
   ============================================================ */

(function () {
  'use strict';
  if (!window.QTI18n) return;

  window.QTI18n.register(
    'es',
    {
      // --- 공용 푸터 / 브랜드 패널 ---
      auth_3b9e30: 'Términos',
      auth_d629d0: 'Privacidad',
      auth_a5e5da: 'Seguridad',
      auth_e2654a: 'Ayuda',
      auth_77edb5: 'Hacé preguntas sobre cualquier gráfico.',
      auth_9ab22f: 'vos mantenés el control de cada orden.',
      auth_7e2510:
        '{brand} es software de análisis de gráficos. Preguntá sobre un gráfico con palabras comunes y la IA '
        + 'explica qué muestran los indicadores; si decidís actuar, la orden se ejecuta en tu propia cuenta del '
        + 'exchange después de que la apruebes. No custodiamos tus fondos, no los administramos y no recomendamos '
        + 'qué comprar.',
      auth_833f52: 'Lenguaje común → vos dibujás los overlays → armás tu propia configuración',
      auth_66cdd9: 'Arrastrá, cambiá el tamaño y guardá presets de tu diseño',
      auth_2d0495: 'Aprobar ≠ Enviar · control de riesgo en varias etapas',

      // --- 로그인 ---
      login_e225a6: 'Iniciar sesión',
      login_3f05db: 'Iniciá sesión en tu cuenta de {brand}',
      login_92c6f3: 'Olvidé mi contraseña',
      login_a89650: 'Recordar este dispositivo (30 días)',
      login_33c1f7: 'Verificando…',
      login_e2d231: 'Iniciar sesión →',
      login_46bed0: 'o',
      login_68a92d: '¿No tenés cuenta?',
      login_49f561: 'Crear cuenta →',
      login_13d6ae: 'Ingresá cualquier correo y contraseña, y luego cualquier código 2FA de 6 dígitos para entrar a la app',
      login_241c96: 'Verificar →',
      login_f3047a: '¿No recibiste el código?',
      login_6adb8b: 'Reenviar por SMS',
      login_f787eb: '← Volver',

      // --- 회원가입 ---
      signup_ecb4cc: 'Crear cuenta',
      signup_a6f945: 'Toma alrededor de un minuto',
      signup_1ff941: 'Cuenta',
      signup_32b217: 'Correo electrónico',
      signup_d284fa: 'KYC',
      signup_10c83d: 'Al menos 10 caracteres',
      signup_711154: 'Volvé a ingresar la contraseña',
      signup_5ca401: 'La contraseña debe tener al menos 8 caracteres',
      signup_dd3243: 'Las contraseñas no coinciden',
      signup_591c17: 'Muy débil',
      signup_24bb15: 'Débil',
      signup_2179da: 'Aceptable',
      signup_5f67e6: 'Fuerte',
      signup_dff519: 'Muy fuerte',
      signup_b329a3: '🇰🇷 Corea del Sur',
      signup_44650a: 'Otro',
      signup_75a112: 'Acepto (obligatorio)',
      signup_532136: 'Política de Privacidad',
      signup_21e2e3: 'Recibir correos de marketing (opcional)',
      signup_24cd06: 'Procesando…',
      signup_3929bb: 'Crear cuenta →',
      signup_9922a0: '¿Ya tenés una cuenta?',

      // --- 이메일 인증 ---
      email_verify_5eb00e: 'Enviamos un enlace de verificación a tu correo. Abrilo para verificar y después iniciá sesión.',
      email_verify_0fa353: 'Si no llega, revisá la carpeta de spam.',
      email_verify_37a414: 'Reenviar',
      email_verify_089bb3: '✓ Reenviado',
      email_verify_455f7c: 'Continuar →',

      // --- KYC ---
      k_y_c_onboarding_5f6780: 'Verificación de identidad (KYC)',
      k_y_c_onboarding_9334ed: '👤 Información básica',
      k_y_c_onboarding_31fbff: 'Fecha de nacimiento',
      k_y_c_onboarding_ff63ca: 'Nacionalidad',
      k_y_c_onboarding_c22557: 'Seleccionar',
      k_y_c_onboarding_ebce71: '🏠 Domicilio',
      k_y_c_onboarding_dad291: 'Domicilio línea 2',
      k_y_c_onboarding_02220b: 'El comprobante de domicilio se sube en el paso siguiente.',
      k_y_c_onboarding_8ff495: '🪪 Documento de identidad · selfie',
      k_y_c_onboarding_3f327d: 'Elegí el tipo de documento.',
      k_y_c_onboarding_3ba1d5: 'Documento nacional de identidad',
      k_y_c_onboarding_311122: 'Licencia de conducir',
      k_y_c_onboarding_8e5bec: 'Pasaporte',
      k_y_c_onboarding_26c302: 'Frente del documento',
      k_y_c_onboarding_2b9e56: 'Dorso del documento',
      k_y_c_onboarding_f8bbc7: 'No se requiere para pasaporte',
      k_y_c_onboarding_51672c: 'Subir',
      k_y_c_onboarding_6cfe7d: 'JPG · PNG · PDF (máx. 10MB)',
      k_y_c_onboarding_de4a5c: 'Selfie en vivo',
      k_y_c_onboarding_90745c: 'Fotografiá tu cara junto con tu documento',
      k_y_c_onboarding_e07e2e: 'Abrir cámara',
      k_y_c_onboarding_0f797f: '📋 Origen de los fondos · finalidad',
      k_y_c_onboarding_f01127: 'Origen de los fondos',
      k_y_c_onboarding_edd43e: 'Ingresos por empleo',
      k_y_c_onboarding_7fb985: 'Ingresos por actividad comercial',
      k_y_c_onboarding_f27c14: 'Rendimientos de inversiones',
      k_y_c_onboarding_98ae59: 'Ahorros',
      k_y_c_onboarding_7340b7: 'Herencia o donación',
      k_y_c_onboarding_898ed0: 'Finalidad de la operación',
      k_y_c_onboarding_aa6c8f: 'Inversión de largo plazo',
      k_y_c_onboarding_e18ea9: 'Especulación · ganancias de corto plazo',
      k_y_c_onboarding_5d5aea: 'Cobertura · gestión de riesgo',
      k_y_c_onboarding_d66780: 'Arbitraje',
      k_y_c_onboarding_810016: '← Volver',
      k_y_c_onboarding_c5798c: 'Siguiente →',
      k_y_c_onboarding_4f67fa: 'Enviar a revisión →',
      k_y_c_onboarding_dc301f: 'Enviado a revisión',
      k_y_c_onboarding_2ecb11: 'KYC enviado 🎉',
      k_y_c_onboarding_55af46: 'Aprobación en 1-24 horas · te avisamos por correo',
      k_y_c_onboarding_03e1e5: 'Abrir la app →',
      kyc_step_progress: 'Paso {step} / {total} · unos 3-5 min',

      // --- 비밀번호 재설정 ---
      password_reset_8d8082: 'Restablecer contraseña',
      password_reset_d196c8: 'Enviaremos un enlace de restablecimiento al correo registrado',
      password_reset_7badb1: 'Enviar enlace de restablecimiento →',
      password_reset_5ee6ba: '← Volver a iniciar sesión',
      password_reset_d09993: 'Correo enviado',
      password_reset_a40b90: 'Ir a iniciar sesión →',
      pwreset_link_sent: 'Enlace de restablecimiento enviado a {email}.',

      // --- 랜딩 ---
      landing_66a662: 'Somos una empresa de software. No custodiamos tu dinero, no lo administramos y no te decimos qué comprar.',
      landing_7bbd5b: 'Empezar gratis',
      landing_1ea899: 'Ver demo',
      landing_4c1fc3: 'La IA responde',
      landing_af3947: ' — vos decidís qué hacer.',
      landing_5f6b64: 'Preguntá en lenguaje común y ChartControl AI te ayuda a marcar soporte/resistencia, líneas de tendencia e indicadores en el gráfico que estás viendo, con datos de mercado en vivo. Todo es un borrador que vos creás y decidís — es una herramienta de gráficos, no asesoramiento de inversión.',
      landing_44cbb3: 'Arrastrá y redimensioná libremente · 7 presets (Standard / Scalper / Multi / AI y más)',
      landing_40f668: 'Aprobación de la IA ≠ envío de la orden · control de riesgo de 9 etapas · franja de simulación siempre visible',
      landing_69704c: 'Etiquetas de ánimo · rendimiento por hora del día · detección automática de patrones',
      landing_1351e7: 'Para principiantes',
      landing_74f8f5: 'Para traders de tiempo completo',
      landing_b7f95d: 'Institucional · alta frecuencia',
      landing_b8adca: 'Empezar gratis',
      landing_0077f3: 'Empezar con Pro',
      landing_531f6a: 'Contactanos',
      landing_0fc1ee: 'Contacto',
      landing_04b7df: '/mes',
      landing_9c7f54: '5 símbolos favoritos',
      landing_4f403f: 'Todos los símbolos',
      landing_724991: 'Herramientas de gráfico con IA · 5 por día',
      landing_6e9bb1: 'Herramientas de gráfico con IA · ilimitadas',
      landing_8466e2: 'Indicadores esenciales',
      landing_d3219e: 'Operaciones esenciales',
      landing_bc5424: 'Multigráfico',
      landing_c3d5f3: 'Tipos de orden avanzados',
      landing_1a4272: 'Backtesting de estrategias',
      landing_91e9d6: 'Alertas en tiempo real',
      landing_633158: 'Ejecutivo dedicado',
      landing_6587f1: 'API dedicada',
      landing_860f96: 'Negociación de comisiones',
      landing_0af146: 'Opción on-premise',

      // --- 404 ---
      not_found_eeedd6: 'No encontramos esa página',
      not_found_9acdbe: 'La dirección puede estar mal o la página pudo haber sido eliminada.',
      not_found_e62d56: 'Probá una de estas páginas:',
      not_found_e87cf6: 'Operar →',
      not_found_7f5914: 'Mercados',
      not_found_d9477a: 'Portafolio',
      not_found_1c767f: 'Página de inicio →',
    },
    { label: 'Español (LatAm)', bcp47: 'es-419' },
  );
})();
