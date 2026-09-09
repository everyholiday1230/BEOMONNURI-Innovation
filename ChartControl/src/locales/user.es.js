/* ============================================================
   Español (Latinoamérica) — 사용자 화면 (pages-user.jsx) 사전
   ------------------------------------------------------------
   키는 tools/i18n-extract.py 가 생성한 것이며 바꾸지 않는다. 값만 번역한다.
   ★ {brand} {msg} 치환자는 그대로 남긴다.
   ============================================================ */

(function () {
  'use strict';
  if (!window.QTI18n) return;

  window.QTI18n.register(
    'es',
    {
      // --- Analytics: AI 인사이트 ---
      analytics_19b9a2: 'Las operaciones basadas en señales de IA rinden significativamente mejor que las operaciones discrecionales.',
      analytics_c511d6: '✓ La sesión de la tarde rinde mejor',
      analytics_4b3b6f: 'Las operaciones entre 12:00–16:00 UTC promedian un PnL 34% mayor que en otras horas.',
      analytics_d6aabf: '⚠ Las operaciones hechas con nervios pierden el 40% de las veces',
      analytics_4fa8b3: 'Entrar mientras el ánimo está "nervioso" aumenta la probabilidad de pérdida 2,3×.',

      // --- Notifications ---
      notifications_f53a6e: 'Filtrar',
      notifications_f6bc37: 'Marcar todo como leído',

      // --- Order history ---
      order_history_ea8391: 'Todas las órdenes · abiertas · ejecutadas · canceladas',

      // --- Wallet ---
      wallet_ed546c: 'Conexiones con exchanges',
      wallet_95195c: 'Exchanges compatibles · gestión de API keys · activos · depósitos y retiros',
      wallet_ea90da: '🎁 Exchanges asociados de {brand}',
      wallet_ceef92: 'Los exchanges de abajo son nuestros socios y ofrecen ',
      wallet_cbe9e9: 'devolución de comisiones y bono de bienvenida',
      wallet_fc0c97: '. Registrate con el enlace de referido, creá una API key y conectala en esta página.',
      wallet_ecb4cc: 'Registrarse',
      wallet_f23807: 'Saldos de activos',
      wallet_b9ca11: 'Depositar',
      wallet_972169: 'Retirar',
      wallet_57177e: 'Ir a depósito →',
      wallet_d3cdff: 'Ir a retiro →',

      // --- Settings: 탭 ---
      settings_2d430b: 'Perfil · seguridad · notificaciones · API keys · accesibilidad',
      settings_14fab1: 'Perfil',
      settings_cfaa68: 'Seguridad · 2FA',
      settings_e29d14: 'Notificaciones',
      settings_643822: 'Preferencias',
      settings_3a4173: 'Accesibilidad',
      settings_5a4346: 'Cuenta',

      // --- Settings: 프로필 ---
      settings_0d64b7: 'Datos del perfil',
      settings_b7909f: 'Cambiar foto',
      settings_9aa18e: 'Nombre',
      settings_3c3776: 'Correo electrónico',
      settings_84b6d0: 'País',
      settings_76245e: 'Zona horaria',
      settings_6e081b: 'Coreano',
      settings_1f1712: 'Guardar',
      settings_19b2d1: 'Cancelar',

      // --- Settings: 보안 ---
      settings_965a8c: 'Contraseña y 2FA',
      settings_819738: 'Contraseña',
      settings_9074af: 'Cambiada por última vez hace 63 días',
      settings_ce0109: 'Cambiar',
      settings_a5d18c: 'Autenticación de dos factores (TOTP)',
      settings_e33c1f: '✓ Activada · Google Authenticator',
      settings_ee3963: 'Restablecer',
      settings_872543: 'Verificación por SMS',
      settings_4bd28a: 'Sesiones de inicio',
      settings_2ac6ff: '3 sesiones activas',
      settings_b7a78a: 'Sesión actual',
      settings_3c8a15: 'hace 2 días · ⚠ ubicación distinta',
      settings_cafdc6: 'Cerrar',
      settings_8eb853: 'API keys de exchanges conectados · permisos · restricciones de IP',

      // --- Settings: 알림 ---
      settings_16930c: 'Configuración de notificaciones',
      settings_b83309: 'Se generó una señal de IA',
      settings_37397b: 'Orden ejecutada · cancelada',
      settings_716902: 'Avisos de margen · liquidación',
      settings_15d236: 'Anuncios',
      settings_2207de: 'Promociones · eventos',

      // --- Settings: 접근성 ---
      settings_12d487: 'Reducir movimiento',
      settings_dc3d8a: 'Minimizar animaciones y transiciones (WCAG 2.3.3)',
      settings_02bb1c: 'Alto contraste',
      settings_a63c4a: 'Mayor contraste de color (WCAG AAA)',
      settings_a5d169: 'Apoyo para daltonismo',
      settings_3f9048: 'Mostrar long/short también con patrones e íconos',
      settings_c56d3c: 'Texto grande',
      settings_bbb99f: 'Aumentar todos los tamaños de letra un 20%',
      settings_816538: 'Anillo de foco reforzado',
      settings_fa2fee: 'Contorno 2px → 3px · énfasis de color',
      settings_c35257: 'Modo solo teclado',
      settings_4599e3: 'Llegar a todas las funciones sin mouse',
      settings_625fc6: 'Optimización para lector de pantalla',
      settings_da0cf0: 'Etiquetas ARIA mejoradas · orden de recorrido reorganizado',
      settings_a2d19e: 'Restaurar valores predeterminados',

      // --- Settings: 데이터 / 계정 ---
      settings_be6117: 'Gestión de datos',
      settings_2508a1: 'Descargar datos (GDPR)',
      settings_d15b63: 'Exportación completa en JSON de la cuenta, operaciones y configuración',
      settings_74e36c: 'Solicitar',
      settings_0207e4: 'Descargar registro de uso de la API',
      settings_c523ec: 'Últimos 90 días · CSV',
      settings_f1d559: '⚠ Zona de riesgo',
      settings_7cbf79: 'Suspender cuenta',
      settings_4957e1: 'Desactivar por hasta 90 días · se puede reactivar después',
      settings_340d4e: 'Suspender',
      settings_009e27: 'Eliminar la cuenta de forma permanente',
      settings_560adc: 'Borra todos los datos · no se puede recuperar · requiere 2FA + confirmación por correo',
      settings_254a82: 'Solicitar eliminación',

      wal_revoke_confirm: '¿Revocar esta API key? El envío de órdenes y la lectura de saldo se detienen de inmediato. No se puede deshacer — después podés conectar una key nueva.',
      wal_revoke_failed: 'No se pudo revocar la key: {msg}. Sigue activa — intentá de nuevo, o eliminala en el exchange.',

      strat_needs_key: 'Conectá una API key de exchange para usar esto — estas son estrategias de ejemplo.',
    },
    { label: 'Español (LatAm)', bcp47: 'es-419' },
  );
})();
