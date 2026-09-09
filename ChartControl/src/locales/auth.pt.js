/* ============================================================
   Português (Brasil) — 인증 화면 (pages-auth.jsx) 사전
   ------------------------------------------------------------
   키는 tools/i18n-extract.py 가 생성한 것이며 바꾸지 않는다. 값만 번역한다.

   ★ 빠진 키는 i18n 이 en 으로 자동 폴백한다.
   ★ {brand} {step} {total} {email} 치환자는 그대로 남긴다.
   ★ CVM 규제상 투자 성과·수익을 암시하는 표현을 넣지 않는다. 원문의 면책 톤 유지.
   ============================================================ */

(function () {
  'use strict';
  if (!window.QTI18n) return;

  window.QTI18n.register(
    'pt',
    {
      // --- 공용 푸터 / 브랜드 패널 ---
      auth_3b9e30: 'Termos',
      auth_d629d0: 'Privacidade',
      auth_a5e5da: 'Segurança',
      auth_e2654a: 'Ajuda',
      auth_77edb5: 'Faça perguntas sobre qualquer gráfico.',
      auth_9ab22f: 'você mantém o controle de cada ordem.',
      auth_7e2510:
        'O {brand} é um software de análise de gráficos. Pergunte sobre um gráfico em linguagem simples e a IA '
        + 'explica o que os indicadores mostram; se você decidir agir, a ordem é executada na sua própria conta '
        + 'na exchange depois da sua aprovação. Não custodiamos seus fundos, não os gerenciamos e não recomendamos '
        + 'o que comprar.',
      auth_833f52: 'Linguagem simples → você desenha os overlays → monta sua própria configuração',
      auth_66cdd9: 'Arraste, redimensione e salve presets do seu layout',
      auth_2d0495: 'Aprovar ≠ Enviar · verificação de risco em várias etapas',

      // --- 로그인 ---
      login_e225a6: 'Entrar',
      login_3f05db: 'Entre na sua conta {brand}',
      login_92c6f3: 'Esqueci a senha',
      login_a89650: 'Lembrar deste dispositivo (30 dias)',
      login_33c1f7: 'Verificando…',
      login_e2d231: 'Entrar →',
      login_46bed0: 'ou',
      login_68a92d: 'Não tem uma conta?',
      login_49f561: 'Criar conta →',
      login_13d6ae: 'Digite qualquer e-mail e senha e, em seguida, qualquer código 2FA de 6 dígitos para entrar no app',
      login_241c96: 'Verificar →',
      login_f3047a: 'Não recebeu o código?',
      login_6adb8b: 'Reenviar por SMS',
      login_f787eb: '← Voltar',

      // --- 회원가입 ---
      signup_ecb4cc: 'Criar conta',
      signup_a6f945: 'Leva cerca de um minuto',
      signup_1ff941: 'Conta',
      signup_32b217: 'E-mail',
      signup_d284fa: 'KYC',
      signup_10c83d: 'No mínimo 10 caracteres',
      signup_711154: 'Digite a senha novamente',
      signup_5ca401: 'A senha precisa ter ao menos 8 caracteres',
      signup_dd3243: 'As senhas não coincidem',
      signup_591c17: 'Muito fraca',
      signup_24bb15: 'Fraca',
      signup_2179da: 'Razoável',
      signup_5f67e6: 'Forte',
      signup_dff519: 'Muito forte',
      signup_b329a3: '🇰🇷 Coreia do Sul',
      signup_44650a: 'Outro',
      signup_75a112: 'Eu concordo (obrigatório)',
      signup_532136: 'Política de Privacidade',
      signup_21e2e3: 'Receber e-mails de marketing (opcional)',
      signup_24cd06: 'Processando…',
      signup_3929bb: 'Criar conta →',
      signup_9922a0: 'Já tem uma conta?',

      // --- 이메일 인증 ---
      email_verify_5eb00e: 'Enviamos um link de verificação para o seu e-mail. Abra o link para verificar e depois faça login.',
      email_verify_0fa353: 'Se não chegar, verifique a pasta de spam.',
      email_verify_37a414: 'Reenviar',
      email_verify_089bb3: '✓ Reenviado',
      email_verify_455f7c: 'Continuar →',

      // --- KYC ---
      k_y_c_onboarding_5f6780: 'Verificação de identidade (KYC)',
      k_y_c_onboarding_9334ed: '👤 Informações básicas',
      k_y_c_onboarding_31fbff: 'Data de nascimento',
      k_y_c_onboarding_ff63ca: 'Nacionalidade',
      k_y_c_onboarding_c22557: 'Selecionar',
      k_y_c_onboarding_ebce71: '🏠 Endereço',
      k_y_c_onboarding_dad291: 'Complemento',
      k_y_c_onboarding_02220b: 'O comprovante de endereço é enviado na próxima etapa.',
      k_y_c_onboarding_8ff495: '🪪 Documento de identidade · selfie',
      k_y_c_onboarding_3f327d: 'Escolha o tipo de documento.',
      k_y_c_onboarding_3ba1d5: 'Documento de identidade (RG)',
      k_y_c_onboarding_311122: 'Carteira de motorista (CNH)',
      k_y_c_onboarding_8e5bec: 'Passaporte',
      k_y_c_onboarding_26c302: 'Frente do documento',
      k_y_c_onboarding_2b9e56: 'Verso do documento',
      k_y_c_onboarding_f8bbc7: 'Não é necessário para passaporte',
      k_y_c_onboarding_51672c: 'Enviar arquivo',
      k_y_c_onboarding_6cfe7d: 'JPG · PNG · PDF (máx. 10MB)',
      k_y_c_onboarding_de4a5c: 'Selfie ao vivo',
      k_y_c_onboarding_90745c: 'Fotografe seu rosto junto com o documento',
      k_y_c_onboarding_e07e2e: 'Abrir câmera',
      k_y_c_onboarding_0f797f: '📋 Origem dos recursos · finalidade',
      k_y_c_onboarding_f01127: 'Origem dos recursos',
      k_y_c_onboarding_edd43e: 'Renda do trabalho',
      k_y_c_onboarding_7fb985: 'Renda empresarial',
      k_y_c_onboarding_f27c14: 'Retornos de investimentos',
      k_y_c_onboarding_98ae59: 'Poupança',
      k_y_c_onboarding_7340b7: 'Herança ou doação',
      k_y_c_onboarding_898ed0: 'Finalidade da negociação',
      k_y_c_onboarding_aa6c8f: 'Investimento de longo prazo',
      k_y_c_onboarding_e18ea9: 'Especulação · ganhos de curto prazo',
      k_y_c_onboarding_5d5aea: 'Hedge · gestão de risco',
      k_y_c_onboarding_d66780: 'Arbitragem',
      k_y_c_onboarding_810016: '← Voltar',
      k_y_c_onboarding_c5798c: 'Avançar →',
      k_y_c_onboarding_4f67fa: 'Enviar para análise →',
      k_y_c_onboarding_dc301f: 'Enviado para análise',
      k_y_c_onboarding_2ecb11: 'KYC enviado 🎉',
      k_y_c_onboarding_55af46: 'Aprovação em 1-24 horas · você será avisado por e-mail',
      k_y_c_onboarding_03e1e5: 'Abrir o app →',
      kyc_step_progress: 'Etapa {step} / {total} · cerca de 3-5 min',

      // --- 비밀번호 재설정 ---
      password_reset_8d8082: 'Redefinir senha',
      password_reset_d196c8: 'Enviaremos um link de redefinição para o e-mail cadastrado',
      password_reset_7badb1: 'Enviar link de redefinição →',
      password_reset_5ee6ba: '← Voltar para o login',
      password_reset_d09993: 'E-mail enviado',
      password_reset_a40b90: 'Ir para o login →',
      pwreset_link_sent: 'Link de redefinição enviado para {email}.',

      // --- 랜딩 ---
      landing_66a662: 'Somos uma empresa de software. Não custodiamos seu dinheiro, não o gerenciamos e não dizemos o que você deve comprar.',
      landing_7bbd5b: 'Começar grátis',
      landing_1ea899: 'Ver demonstração',
      landing_4c1fc3: 'A IA responde',
      landing_af3947: ' — você decide o que fazer.',
      landing_5f6b64: 'Pergunte em linguagem simples e o ChartControl AI ajuda você a marcar suporte/resistência, linhas de tendência e indicadores no gráfico que está vendo, usando dados de mercado ao vivo. Tudo é um rascunho que você cria e decide — é uma ferramenta de gráficos, não recomendação de investimento.',
      landing_44cbb3: 'Arraste e redimensione livremente · 7 presets (Standard / Scalper / Multi / AI e outros)',
      landing_40f668: 'Aprovação da IA ≠ envio de ordem · verificação de risco em 9 etapas · faixa de simulação sempre visível',
      landing_69704c: 'Tags de humor · desempenho por horário do dia · detecção automática de padrões',
      landing_1351e7: 'Para iniciantes',
      landing_74f8f5: 'Para traders em tempo integral',
      landing_b7f95d: 'Institucional · alta frequência',
      landing_b8adca: 'Começar grátis',
      landing_0077f3: 'Começar no Pro',
      landing_531f6a: 'Fale com a gente',
      landing_0fc1ee: 'Contato',
      landing_04b7df: '/mês',
      landing_9c7f54: '5 ativos favoritos',
      landing_4f403f: 'Todos os ativos',
      landing_724991: 'Ferramentas de gráfico com IA · 5 por dia',
      landing_6e9bb1: 'Ferramentas de gráfico com IA · ilimitadas',
      landing_8466e2: 'Indicadores essenciais',
      landing_d3219e: 'Negociação essencial',
      landing_bc5424: 'Multigráficos',
      landing_c3d5f3: 'Tipos de ordem avançados',
      landing_1a4272: 'Backtest de estratégias',
      landing_91e9d6: 'Alertas em tempo real',
      landing_633158: 'Gerente dedicado',
      landing_6587f1: 'API dedicada',
      landing_860f96: 'Negociação de taxas',
      landing_0af146: 'Opção on-premise',

      // --- 404 ---
      not_found_eeedd6: 'Não encontramos essa página',
      not_found_9acdbe: 'O endereço pode estar errado ou a página pode ter sido removida.',
      not_found_e62d56: 'Tente uma destas páginas:',
      not_found_e87cf6: 'Operar →',
      not_found_7f5914: 'Mercados',
      not_found_d9477a: 'Carteira',
      not_found_1c767f: 'Página inicial →',
    },
    { label: 'Português (BR)', bcp47: 'pt-BR' },
  );
})();
