# Predator Optimizer

Otimizador **seguro e reversível** para notebooks Acer Predator (Windows 10/11). Sem instalação: só PowerShell nativo.

## Como usar
1. Baixe a pasta `predator-optimizer` para o Windows.
2. Dê dois cliques em **Iniciar.bat** (pede permissão de administrador).
3. Rode **1) Diagnóstico**, depois **8) Pacote recomendado**, e reinicie.
4. Se algo não agradar: **6) Desfazer tudo**.

## O que faz (e o que NÃO faz)
| Faz | Não faz |
|---|---|
| Cria ponto de restauração antes de aplicar | Não edita registro do sistema, serviços, drivers, BCD ou pagefile |
| Cria um plano de energia **novo** (o seu não é alterado) com refrigeração ativa (ventoinha sobe antes do clock cair) e turbo eficiente | Não desativa Defender/Windows Update |
| Liga a compressão de memória (se desligada) | Não usa "limpador de RAM" (piora o desempenho) |
| Apaga só temporários com +7 dias | Não apaga cache de sistema, prefetch, WinSxS |
| Desativa itens de inicialização via StartupApproved (reversível); drivers/segurança/Acer/NVIDIA ficam protegidos | |
| Monitor ao vivo com detecção de throttle e log CSV | |

Backup do que foi alterado: `C:\ProgramData\PredatorOptimizer\backup.json` (log em `log.txt`).

## Perfis de energia
1. **Equilibrado-frio** (recomendado): turbo eficiente + cooling ativo.
2. **Frio**: sem turbo (CPU 99%) — bem mais fresco, menos pico.
3. **Desempenho**: turbo total, com cooling ativo.
Na bateria o turbo é sempre desligado nos perfis 1 e 2.

## O que software não resolve (maiores ganhos reais)
- PredatorSense: modo Turbo + ventoinhas em Auto/Max ao jogar/renderizar.
- Sempre na tomada com o carregador original.
- Limpar saídas de ar; base cooler; trocar pasta térmica/metal líquido se o notebook tem 1-2+ anos.
- Atualizar BIOS e driver NVIDIA/Intel pelo site da Acer.
- Limitar FPS (V-Sync / limite de FPS) e usar undervolt/limite de potência da GPU (MSI Afterburner) — o maior redutor de calor com pouca perda de desempenho.

> Aviso: escrito sem acesso a um Windows para teste. Rode primeiro a opção 1 (somente leitura) e me mande o resultado/erros que eu ajusto.
