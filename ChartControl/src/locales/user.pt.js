/* ============================================================
   Português (Brasil) — 사용자 화면 (pages-user.jsx) 사전
   ------------------------------------------------------------
   키는 tools/i18n-extract.py 가 생성한 것이며 바꾸지 않는다. 값만 번역한다.
   ★ {brand} {msg} 치환자는 그대로 남긴다.
   ============================================================ */

(function () {
  'use strict';
  if (!window.QTI18n) return;

  window.QTI18n.register(
    'pt',
    {
      // --- Analytics: AI 인사이트 ---
      analytics_19b9a2: 'Operações baseadas em sinais de IA superam de forma significativa as operações discricionárias.',
      analytics_c511d6: '✓ A sessão da tarde tem melhor desempenho',
      analytics_4b3b6f: 'Operações entre 12:00–16:00 UTC têm PnL médio 34% maior do que nos outros horários.',
      analytics_d6aabf: '⚠ Operações feitas sob nervosismo perdem 40% das vezes',
      analytics_4fa8b3: 'Entrar enquanto o humor está "nervoso" aumenta a probabilidade de perda em 2,3×.',

      // --- Notifications ---
      notifications_f53a6e: 'Filtrar',
      notifications_f6bc37: 'Marcar tudo como lido',

      // --- Order history ---
      order_history_ea8391: 'Todas as ordens · abertas · executadas · canceladas',

      // --- Wallet ---
      wallet_ed546c: 'Conexões com exchanges',
      wallet_95195c: 'Exchanges suportadas · gestão de API keys · ativos · depósitos e saques',
      wallet_ea90da: '🎁 Exchanges parceiras da {brand}',
      wallet_ceef92: 'As exchanges abaixo são nossas parceiras e oferecem ',
      wallet_cbe9e9: 'desconto em taxas e bônus de boas-vindas',
      wallet_fc0c97: '. Cadastre-se pelo link de indicação, crie uma API key e conecte-a nesta página.',
      wallet_ecb4cc: 'Cadastrar-se',
      wallet_f23807: 'Saldos de ativos',
      wallet_b9ca11: 'Depositar',
      wallet_972169: 'Sacar',
      wallet_57177e: 'Ir para depósito →',
      wallet_d3cdff: 'Ir para saque →',

      // --- Settings: 탭 ---
      settings_2d430b: 'Perfil · segurança · notificações · API keys · acessibilidade',
      settings_14fab1: 'Perfil',
      settings_cfaa68: 'Segurança · 2FA',
      settings_e29d14: 'Notificações',
      settings_643822: 'Preferências',
      settings_3a4173: 'Acessibilidade',
      settings_5a4346: 'Conta',

      // --- Settings: 프로필 ---
      settings_0d64b7: 'Dados do perfil',
      settings_b7909f: 'Alterar foto',
      settings_9aa18e: 'Nome',
      settings_3c3776: 'E-mail',
      settings_84b6d0: 'País',
      settings_76245e: 'Fuso horário',
      settings_6e081b: 'Coreano',
      settings_1f1712: 'Salvar',
      settings_19b2d1: 'Cancelar',

      // --- Settings: 보안 ---
      settings_965a8c: 'Senha e 2FA',
      settings_819738: 'Senha',
      settings_9074af: 'Alterada pela última vez há 63 dias',
      settings_ce0109: 'Alterar',
      settings_a5d18c: 'Autenticação de dois fatores (TOTP)',
      settings_e33c1f: '✓ Ativada · Google Authenticator',
      settings_ee3963: 'Redefinir',
      settings_872543: 'Verificação por SMS',
      settings_4bd28a: 'Sessões de login',
      settings_2ac6ff: '3 sessões ativas',
      settings_b7a78a: 'Sessão atual',
      settings_3c8a15: 'há 2 dias · ⚠ localização diferente',
      settings_cafdc6: 'Encerrar',
      settings_8eb853: 'API keys de exchanges conectadas · permissões · restrições de IP',

      // --- Settings: 알림 ---
      settings_16930c: 'Configurações de notificação',
      settings_b83309: 'Sinal de IA gerado',
      settings_37397b: 'Ordem executada · cancelada',
      settings_716902: 'Avisos de margem · liquidação',
      settings_15d236: 'Comunicados',
      settings_2207de: 'Promoções · eventos',

      // --- Settings: 접근성 ---
      settings_12d487: 'Reduzir movimento',
      settings_dc3d8a: 'Minimizar animações e transições (WCAG 2.3.3)',
      settings_02bb1c: 'Alto contraste',
      settings_a63c4a: 'Contraste de cor mais forte (WCAG AAA)',
      settings_a5d169: 'Suporte a daltonismo',
      settings_3f9048: 'Mostrar long/short também com padrões e ícones',
      settings_c56d3c: 'Texto grande',
      settings_bbb99f: 'Aumentar todos os tamanhos de fonte em 20%',
      settings_816538: 'Anel de foco reforçado',
      settings_fa2fee: 'Contorno 2px → 3px · ênfase de cor',
      settings_c35257: 'Modo somente teclado',
      settings_4599e3: 'Acessar todos os recursos sem mouse',
      settings_625fc6: 'Otimização para leitor de tela',
      settings_da0cf0: 'Rótulos ARIA aprimorados · ordem de navegação reorganizada',
      settings_a2d19e: 'Restaurar padrões',

      // --- Settings: 데이터 / 계정 ---
      settings_be6117: 'Gestão de dados',
      settings_2508a1: 'Baixar dados (GDPR)',
      settings_d15b63: 'Exportação completa em JSON da conta, operações e configurações',
      settings_74e36c: 'Solicitar',
      settings_0207e4: 'Baixar log de uso da API',
      settings_c523ec: 'Últimos 90 dias · CSV',
      settings_f1d559: '⚠ Zona de risco',
      settings_7cbf79: 'Suspender conta',
      settings_4957e1: 'Desativar por até 90 dias · pode ser reativada depois',
      settings_340d4e: 'Suspender',
      settings_009e27: 'Excluir conta permanentemente',
      settings_560adc: 'Apaga todos os dados · não é recuperável · exige 2FA + confirmação por e-mail',
      settings_254a82: 'Solicitar exclusão',

      wal_revoke_confirm: 'Revogar esta API key? O envio de ordens e a leitura de saldo param imediatamente. Isso não pode ser desfeito — depois você pode conectar uma nova key.',
      wal_revoke_failed: 'Não foi possível revogar a key: {msg}. Ela continua ativa — tente novamente ou remova-a na exchange.',

      strat_needs_key: 'Conecte uma API key de exchange para usar isso — estas são estratégias de exemplo.',
    },
    { label: 'Português (BR)', bcp47: 'pt-BR' },
  );
})();
