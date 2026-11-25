/* Small UI translation layer. It translates interface text, never track, album or artist
 * names: those are data. The dictionary is exact-match plus a few plural/summary patterns,
 * so an English string that is not in it stays as it is instead of being mangled.
 * Portuguese is selected automatically from the browser, or explicitly in Settings. */
(function () {
  const KEY = 'mf-lang';
  const supported = ['en', 'pt-BR'];
  const saved = (() => { try { return localStorage.getItem(KEY); } catch { return null; } })();
  const browser = String(navigator.language || navigator.languages?.[0] || 'en');
  const lang = supported.includes(saved) ? saved : (browser.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en');
  document.documentElement.lang = lang;

  const pt = {
    // navigation and common controls
    'Home': 'Início', 'Search': 'Buscar', 'Library': 'Biblioteca', 'Playlists': 'Listas',
    'PLAYLISTS': 'LISTAS', 'Liked Songs': 'Músicas curtidas', '+ New playlist': '+ Nova lista',
    '+ Import Spotify playlist': '+ Importar lista do Spotify',
    'Prep': 'Preparar', 'Settings': 'Ajustes', 'Queue': 'Fila', 'Downloads': 'Downloads',
    'Back': 'Voltar', 'Play': 'Reproduzir', 'Pause': 'Pausar', 'Next': 'Próxima',
    'Previous': 'Anterior', 'Shuffle': 'Aleatório', 'Repeat': 'Repetir', 'Volume': 'Volume',
    'Like': 'Curtir', 'More options': 'Mais opções', 'Save': 'Salvar', 'Cancel': 'Cancelar',
    'Close': 'Fechar', 'Remove': 'Remover', 'Delete': 'Excluir', 'Download': 'Baixar',
    'Clear': 'Limpar', 'Create': 'Criar', 'Add': 'Adicionar', 'Open': 'Abrir',
    // home
    'Flow': 'Flow', 'endless mix from what you play': 'mix sem fim com o que você ouve',
    'Your rotation': 'Sua rotação', 'ON DECK': 'NA FILA', 'SHUFFLE': 'ALEATÓRIO',
    'Recently played': 'Tocadas recentemente', 'Your playlists': 'Suas listas',
    'artist of the week, unheard lately': 'artista da semana, pouco ouvido',
    'more from': 'mais de', 'same key as': 'mesma tonalidade de',
    'in the library, never heard': 'na biblioteca, nunca ouvida',
    'Morning,': 'Bom dia,', 'Afternoon,': 'Boa tarde,', 'Evening,': 'Boa noite,',
    'Late one,': 'Boa madrugada,', 'Deep in it,': 'Sessão longa,',
    'Morning.': 'Bom dia.', 'Afternoon.': 'Boa tarde.', 'Evening.': 'Boa noite.',
    'Late one.': 'Boa madrugada.', 'Deep in it.': 'Sessão longa.',
    'Ready when you are.': 'Quando você quiser.', 'Resume': 'Continuar', 'last track': 'última faixa',
    'All': 'Todas', 'TOTAL': 'TOTAL',
    'PLAY SOMETHING AND IT LANDS HERE': 'TOQUE ALGO E ELE APARECE AQUI',
    // library
    'Filter by title, artist or album': 'Filtrar por título, artista ou álbum',
    'All': 'Todas', 'Downloaded': 'Baixadas', 'Not downloaded': 'Não baixadas',
    'Artists': 'Artistas', 'Albums': 'Álbuns', 'Genres': 'Gêneros',
    'Sort by BPM': 'Ordenar por BPM', 'Upload files': 'Enviar arquivos',
    'Upload a folder': 'Enviar uma pasta', 'Import track': 'Importar faixa',
    'For you': 'Para você', 'Import playlist': 'Importar lista',
    'Recently downloaded': 'Baixadas recentemente', 'Newest first': 'Mais recentes',
    'Oldest first': 'Mais antigas', 'Recently updated': 'Atualizadas recentemente',
    'Most tracks': 'Mais faixas', 'Least prepped': 'Menos preparadas',
    'Most prepped': 'Mais preparadas', 'Show listening': 'Mostrar audição',
    'Hide listening': 'Ocultar audição', 'Name Z-A': 'Nome Z-A',
    'Import Spotify playlist': 'Importar lista do Spotify', 'New playlist': 'Nova lista',
    'unknown artist': 'artista desconhecido', 'Edit metadata': 'Editar metadados',
    'Fix metadata': 'Corrigir metadados', 'Delete from library': 'Excluir da biblioteca',
    'Find higher quality': 'Buscar qualidade melhor', 'Choose cover': 'Escolher capa',
    'on disk': 'no disco', 'tracks': 'faixas', 'track': 'faixa', 'songs': 'músicas',
    'TITLE': 'TÍTULO', 'ARTIST': 'ARTISTA', 'ALBUM': 'ÁLBUM', 'SOURCE': 'ORIGEM',
    'TIME': 'TEMPO', 'DATE ADDED': 'ADICIONADA', 'SPOTIFY LINK': 'LINK DO SPOTIFY',
    'FROM WHAT YOU PLAY': 'DO QUE VOCÊ OUVE', 'PASTE A LIST OR A LINK': 'COLE UMA LISTA OU UM LINK',
    'NEWEST FIRST': 'MAIS RECENTES', 'ADDS EVERY TRACK INSIDE': 'ADICIONA TODAS AS FAIXAS',
    'ANALYSED': 'ANALISADAS', 'BROWSE BY FAMILY': 'NAVEGAR POR FAMÍLIA',
    // playlist and prep
    'PLAYLIST': 'LISTA', 'Playlist': 'Lista', 'New playlist': 'Nova lista',
    'Listas': 'Listas', 'listening only': 'somente audição', 'no audio': 'sem áudio',
    'need analysis': 'precisa de análise', 'analysed, current': 'analisadas, atualizadas',
    'Harmonic': 'Harmônico', 'DJ set': 'Set de DJ', 'Listening': 'Audição',
    'Upload tracks': 'Enviar faixas', 'Edit album': 'Editar álbum',
    'Delete album': 'Excluir álbum', 'Choose tracks': 'Escolher faixas',
    'Playlist options': 'Opções da lista', 'Add to playlist': 'Adicionar à lista',
    'Remove from this playlist': 'Remover desta lista', 'Start track radio': 'Rádio desta faixa',
    'Save to Liked Songs': 'Salvar em Curtidas', 'Remove from Liked Songs': 'Remover de Curtidas',
    // search
    'Search tracks, artists and albums': 'Buscar faixas, artistas e álbuns',
    'INCLUDE': 'INCLUIR', 'Web sources': 'Fontes da web', 'Long sets': 'Sets longos',
    'Browse all': 'Ver tudo', 'TRACKS': 'FAIXAS', 'Albums by': 'Álbuns de',
    // settings
    'You': 'Você', 'Location': 'Localização', 'Taste': 'Gosto', 'Maintenance': 'Manutenção',
    'Model endpoint': 'Endpoint do modelo', 'Playback': 'Reprodução',
    'Language': 'Idioma', 'Display name': 'Nome de exibição',
    'Email': 'E-mail', 'Timezone': 'Fuso horário', 'City': 'Cidade',
    'Genres you love': 'Gêneros que você gosta', 'Artists you love': 'Artistas que você gosta',
    'Usually listening': 'O que costuma ouvir', 'Keep out of picks': 'Manter fora das escolhas',
    'Save settings': 'Salvar ajustes', 'Repair metadata': 'Corrigir metadados',
    'Let children\'s music shape recommendations': 'Deixar músicas infantis influenciar as recomendações',
    'Base URL': 'URL base', 'Model': 'Modelo', 'API key': 'Chave da API',
    'No city set': 'Nenhuma cidade definida', 'off': 'desligado',
    'keep the original (no transcoding)': 'manter o original (sem conversão)',
    'm4a (smaller)': 'm4a (menor)', 'mp3 (universal)': 'mp3 (universal)',
    'Fill genres': 'Preencher gêneros', 'Fix covers': 'Corrigir capas',
    'Remove duplicates': 'Remover duplicatas', 'Clear cache': 'Limpar cache',
    'Auto-save after plays': 'Salvar automaticamente após reproduções',
    'Download format': 'Formato de download', 'Key names': 'Nomes das tonalidades',
    'Normalize loudness': 'Normalizar volume', 'Target level': 'Nível alvo',
    'Buffer ahead': 'Pré-carregar', 'Clear buffer': 'Limpar buffer',
    'Continue with similar tracks when a playlist ends': 'Continuar com faixas parecidas ao fim da lista',
    'Nothing run yet.': 'Nada executado ainda.', 'Library': 'Biblioteca',
    // metadata dialog
    'Title': 'Título', 'Artist': 'Artista', 'Album': 'Álbum', 'Year': 'Ano',
    'Set album': 'Definir álbum', 'Set year': 'Definir ano',
    'Tick album or year first': 'Marque álbum ou ano primeiro',
    // status and toasts
    'Nothing playing': 'Nada tocando', 'Playing': 'Tocando', 'Paused': 'Pausado',
    'Saved': 'Salvo', 'Metadata saved': 'Metadados salvos', 'Renamed': 'Renomeado',
    'Removed from playlist': 'Removida da lista', 'Deleted': 'Excluída',
    'Could not save those changes': 'Não foi possível salvar as alterações',
    'Could not update those tracks': 'Não foi possível atualizar essas faixas',
  };

  const patterns = [
    [/^(\d+) tracks$/, (m) => `${m[1]} faixas`],
    [/^(\d+) track$/, (m) => `${m[1]} faixa`],
    [/^(\d+) songs$/, (m) => `${m[1]} músicas`],
    [/^(\d+) song$/, (m) => `${m[1]} música`],
    [/^(\d+) playlists$/, (m) => `${m[1]} listas`],
    [/^(\d+) playlist$/, (m) => `${m[1]} lista`],
    [/\b(\d+) tracks\b/g, (m) => `${m[1]} faixas`],
    [/\b1 track\b/g, () => '1 faixa'],
    [/\bwithout cue points\b/g, () => 'sem cue points'],
    [/\bup to date\b/g, () => 'em dia'],
    [/\bnever analysed\b/g, () => 'nunca analisadas'],
    [/\bnot downloaded\b/g, () => 'não baixadas'],
    [/\bANALYSED\b/g, () => 'ANALISADAS'],
    [/^(\d+) playlists?, ready when you are\.$/, (m) => `${m[1]} ${Number(m[1]) === 1 ? 'lista' : 'listas'}, quando você quiser.`],
    [/^All (\d+) playlists$/, (m) => `Todas as ${m[1]} listas`],
    [/^You left off on /, () => 'Você parou em '],
  ];

  const SKIP = [
    '.tt', '.ta', '.tartist', '.talbum', '.talbum-line', '.tcard-name', '.tcard-sub',
    '.pcard-name', '.pcard-sub', '.plhead-name', '.np-title', '.np-artist', '.np-album',
    '.crate-name', '.lrow-t b', '.crate-row-t b', '.mpick-t b', '.mast-name',
    '.album-chip b', '.q-title', '.q-sub', '.ai-said', '.ask-action-meta', '.avoid-term',
    '.genrechip', '.keychip', '.tno', '.tdur', '.tbpm', '.trbadge', '.tadded',
    '.sec-title small', 'script', 'style', 'textarea',
  ].join(',');

  function isUserContent(node) {
    const el = node.parentElement;
    return !el || !!el.closest(SKIP);
  }

  function translateString(value) {
    if (lang !== 'pt-BR' || !value) return value;
    const key = value.trim();
    if (!key) return value;
    let hit = pt[key];
    if (hit) return value.replace(key, hit);
    let out = key;
    let changed = false;
    for (const [re, fn] of patterns) {
      re.lastIndex = 0;
      if (!re.test(out)) continue;
      re.lastIndex = 0;
      out = out.replace(re, (...args) => fn(args));
      changed = true;
    }
    return changed ? out : value;
  }

  function translateNode(node) {
    const next = translateString(node.nodeValue);
    if (next !== node.nodeValue) node.nodeValue = next;
  }

  function translateAttrs(el) {
    for (const name of ['placeholder', 'title', 'aria-label']) {
      if (!el.hasAttribute || !el.hasAttribute(name)) continue;
      const v = el.getAttribute(name);
      const next = translateString(v);
      if (next !== v) el.setAttribute(name, next);
    }
  }

  function translate(root) {
    if (lang !== 'pt-BR' || !root) return;
    if (root.nodeType === 3) return translateNode(root);
    if (root.nodeType === 1) translateAttrs(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode(n) {
        if (n.nodeType === 3) return isUserContent(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let n = walker.currentNode;
    while ((n = walker.nextNode())) {
      if (n.nodeType === 3) translateNode(n);
      else translateAttrs(n);
    }
  }

  function set(next) {
    try { localStorage.setItem(KEY, next); } catch {}
    location.reload();
  }

  function start() {
    translate(document.body);
    const obs = new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === 'childList') m.addedNodes.forEach((n) => translate(n));
        else if (m.type === 'characterData') translate(m.target);
      }
    });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  window.I18N = { lang, supported, set, translate, t: (s) => translateString(s) };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
