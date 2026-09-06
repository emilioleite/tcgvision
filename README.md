# TCG Vision

MVP PWA para testar reconhecimento de cartas de **Magic: The Gathering** usando a câmera do celular.

## Escopo atual

1. abre a câmera traseira;
2. detecta uma carta mostrada à câmera;
3. identifica a carta localmente com [CollectorVision](https://github.com/HanClinto/CollectorVision);
4. usa o Scryfall ID reconhecido para buscar os metadados;
5. mostra nome, edição e confiança na tela.

Sem juiz, narração, vida, histórico ou regras nesta etapa. O objetivo é medir apenas a qualidade do reconhecimento em condições reais.

## Rodar localmente

O runtime e os modelos do CollectorVision não ficam versionados neste repositório.

```bash
bash scripts/prepare-collectorvision.sh
python3 -m http.server 8040
```

Abra `http://localhost:8040` no mesmo computador. Para usar a câmera em outro aparelho, sirva por **HTTPS** (a câmera do navegador exige contexto seguro fora de `localhost`).

## Testar no celular com GitHub Pages

O workflow `.github/workflows/deploy-pages.yml` prepara o CollectorVision e publica o PWA. No GitHub, configure **Settings → Pages → Source → GitHub Actions** uma vez; depois cada push em `main` dispara o deploy.

## Arquitetura

```text
Câmera do celular
      ↓
CollectorVision (browser/WASM)
      ↓
Scryfall card ID
      ↓
Scryfall API
      ↓
Nome + edição + confiança
```

Os modelos são baixados no primeiro uso e o CollectorVision mantém cache local dos assets no navegador.

## Licença do reconhecimento

CollectorVision é distribuído sob **AGPL-3.0** e oferece licença comercial separada. Este MVP usa o runtime upstream sem modificá-lo. Antes de qualquer uso comercial, revise as obrigações da licença ou substitua/licencie o componente de reconhecimento.
