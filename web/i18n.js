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
    'Include': 'Incluir', 'Filter playlists': 'Filtrar listas', 'Name A-Z': 'Nome A-Z',
    'Filter by title, artist or album': 'Filtrar por título, artista ou álbum',
    // home
    'Flow': 'Flow', 'endless mix from what you play': 'mix sem fim com o que você ouve',
    'Your rotation': 'Sua rotação', 'ON DECK': 'NA FILA', 'SHUFFLE': 'ALEATÓRIO',
    'Recently played': 'Tocadas recentemente', 'Your playlists': 'Suas listas',
    'Fresh in your library': 'Novidades na sua biblioteca',
    'Recently downloaded': 'Baixadas recentemente',
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
    'Sort by BPM': 'Ordenar por BPM', 'Upload files': 'Subir arquivos',
    'Upload a folder': 'Subir uma pasta', 'Import track': 'Importar faixa',
    'For you': 'Para você', 'Import playlist': 'Importar lista',
    'Recently downloaded': 'Baixadas recentemente', 'Newest first': 'Mais recentes',
    'Oldest first': 'Mais antigas', 'Recently updated': 'Atualizadas recentemente',
    'Most tracks': 'Mais faixas', 'Least prepped': 'Menos preparadas',
    'Most prepped': 'Mais preparadas', 'Show listening': 'Mostrar audição',
    'Hide listening': 'Ocultar audição', 'Name Z-A': 'Nome Z-A',
    'Import Spotify playlist': 'Importar lista do Spotify', 'New playlist': 'Nova lista',
    'Upload track': 'Subir faixa', 'Playlist from most-played': 'Lista das mais tocadas',
    'Liked Songs': 'Músicas curtidas',
    'unknown artist': 'artista desconhecido', 'Edit metadata': 'Editar metadados',
    'Fix metadata': 'Corrigir metadados', 'Delete from library': 'Excluir da biblioteca',
    'Find higher quality': 'Buscar qualidade melhor', 'Choose cover': 'Escolher capa',
    'on disk': 'no disco', 'tracks': 'faixas', 'track': 'faixa', 'songs': 'músicas',
    'TITLE': 'TÍTULO', 'ARTIST': 'ARTISTA', 'ALBUM': 'ÁLBUM', 'SOURCE': 'ORIGEM',
    'TIME': 'TEMPO', 'DATE ADDED': 'ADICIONADA', 'SPOTIFY LINK': 'LINK DO SPOTIFY',
    'FROM WHAT YOU PLAY': 'DO QUE VOCÊ OUVE', 'PASTE A LIST OR A LINK': 'COLE UMA LISTA OU UM LINK',
    'NEWEST FIRST': 'MAIS RECENTES', 'ADDS EVERY TRACK INSIDE': 'ADICIONA TODAS AS FAIXAS',
    'ANALYSED': 'ANALISADAS', 'BROWSE BY FAMILY': 'NAVEGAR POR FAMÍLIA',
    'BUILT FROM': 'CRIADO A PARTIR DE',
    // playlist and prep
    'PLAYLIST': 'LISTA', 'Playlist': 'Lista', 'New playlist': 'Nova lista',
    'Listas': 'Listas', 'listening only': 'somente audição', 'no audio': 'sem áudio',
    'need analysis': 'precisa de análise', 'analysed, current': 'analisadas, atualizadas',
    'Harmonic': 'Harmônico', 'DJ set': 'Set de DJ', 'Listening': 'Audição',
    'EXPORT': 'EXPORTAR', 'EXPORT READY': 'PRONTAS PARA EXPORTAR',
    'The playlists you play out — BPM, key, beat grid and cue points ready to export. Listening playlists stay off this page.':
      'As listas que você toca — BPM, tonalidade, grade e cue points prontos para exportar. Listas de audição ficam fora desta página.',
    'Analyze unanalyzed': 'Analisar não analisadas', 'Make playable': 'Tornar reproduzível',
    'ready': 'pronta', 'Re-analyse': 'Analisar novamente',
    'Analyse every track again, including cue points': 'Analisar todas as faixas novamente, incluindo os cue points',
    'No DJ playlists yet. Mark a playlist as a DJ set to prep it.': 'Ainda não há listas de DJ. Marque uma lista como Set de DJ para prepará-la.',
    'this playlist is up to date': 'esta lista está em dia',
    'Prepping': 'Preparando', 'Re-analysing': 'Analisando novamente', 'Starting': 'Iniciando',
    'Analyzing...': 'Analisando...', 'Done': 'Concluído',
    'Every track with audio has been analysed at least once': 'Todas as faixas com áudio já foram analisadas pelo menos uma vez',
    'Upload tracks': 'Subir faixas', 'Edit album': 'Editar álbum',
    'Delete album': 'Excluir álbum', 'Choose tracks': 'Escolher faixas',
    'Playlist options': 'Opções da lista', 'Add to playlist': 'Adicionar à lista',
    'Remove from this playlist': 'Remover desta lista', 'Start track radio': 'Rádio desta faixa',
    'Play next': 'Tocar em seguida', 'Add to queue': 'Adicionar à fila',
    'Go to album': 'Ir para o álbum', 'Go to artist': 'Ir para o artista',
    'Download to device': 'Baixar para o aparelho', 'Save for offline': 'Salvar para usar offline',
    'Remove from offline': 'Remover do offline', 'Write Traktor tags': 'Gravar tags do Traktor',
    'Analyze BPM & key': 'Analisar BPM e tonalidade', 'Re-analyze': 'Analisar novamente',
    'Save to Liked Songs': 'Salvar em Curtidas', 'Remove from Liked Songs': 'Remover de Curtidas',
    // search
    'Search tracks, artists and albums': 'Buscar faixas, artistas e álbuns',
    'INCLUDE': 'INCLUIR', 'Include': 'Incluir', 'Web sources': 'Fontes da web', 'Long sets': 'Sets longos',
    'Browse all': 'Ver tudo', 'TRACKS': 'FAIXAS', 'Albums by': 'Álbuns de',
    // settings
    'Mode': 'Modo', 'Listener': 'Ouvinte', 'DJ': 'DJ',
    'Listener hides Prep, harmonic tools and DJ exports. DJ shows everything.':
      'O modo Ouvinte esconde Preparar, ferramentas harmônicas e exportações de DJ. O modo DJ mostra tudo.',
    'You': 'Você', 'Location': 'Localização', 'Taste': 'Gosto', 'Maintenance': 'Manutenção',
    'Model endpoint': 'Endpoint do modelo', 'Playback': 'Reprodução',
    'Not configured. A&R and Ask use the local planner.': 'Não configurado. A&R e Ask usam o planejador local.',
    'Used by A&R and Ask to interpret requests. Covers, search, downloads and playback do not use it.':
      'Usado por A&R e Ask para interpretar pedidos. Capas, busca, downloads e reprodução não usam isso.',
    'Housekeeping for the library itself. Nothing here changes your files unless it says so.':
      'Manutenção da biblioteca. Nada aqui altera seus arquivos, a menos que seja indicado.',
    'Optional. Used to shape recommendations; the app learns from what you play anyway.':
      'Opcional. Usado para moldar recomendações; o app aprende com o que você ouve.',
    'Display only. Exports always write musical notation, which is what Rekordbox and Traktor read.':
      'Só exibição. As exportações sempre gravam notação musical, que é o que Rekordbox e Traktor leem.',
    'Turns loud tracks down towards a common level, using the loudness measured during analysis. It only ever attenuates — it cannot add distortion and it never rewrites a file. iOS ignores per-track volume, so on a phone or in a car this does nothing.':
      'Reduz faixas altas para um nível comum, usando o volume medido na análise. Só atenua — não adiciona distorção e nunca reescreve um arquivo. O iOS ignora o volume por faixa, então no celular ou no carro isso não faz nada.',
    'Applies to downloads from streaming sources only. Files you upload are stored byte for byte, and lossless files are never converted.':
      'Vale apenas para downloads de fontes de streaming. Arquivos que você sobe são guardados byte a byte, e arquivos sem perda nunca são convertidos.',
    'Used by the greeting and its weather line. Type a city and the coordinates and time zone are looked up for you.': 'Usado pela saudação e pela linha do clima. Digite uma cidade e as coordenadas e o fuso são buscados para você.',
    "Off: children's plays stay in your history but do not move your top genres, tempo, key, picks or rotation.": 'Desligado: músicas infantis ficam no histórico, mas não mudam seus gêneros, tempo, tonalidade, escolhas ou rotação.',
    'Nothing excluded.': 'Nada excluído.',
    'IANA name, e.g. America/Sao_Paulo. Setting a city below fills it in automatically.': 'Nome IANA, ex.: America/Sao_Paulo. Definir uma cidade abaixo preenche isso automaticamente.',
    'Commas. "no" and "non" are ignored, so "non pop" means pop. Matched against genre, family, artist, album and title.': 'Vírgulas. "no" e "non" são ignorados, então "non pop" significa pop. Comparado com gênero, família, artista, álbum e título.',
    'Sources:': 'Fontes:', 'Playback log:': 'Registro de reprodução:', 'Unsaved changes': 'Alterações não salvas',
    'Sources: not checked yet': 'Fontes: ainda não verificadas',
    'Playback log: nothing recorded yet.': 'Registro de reprodução: nada registrado ainda.',
    'Frees preloaded audio and cached pages': 'Libera áudio pré-carregado e páginas em cache',
    "Ask, build or teach: 20 dark techno I don't have · no Imagine Dragons": 'Peça, crie ou ensine: 20 techno sombrio que eu não tenho · sem Imagine Dragons',
    'tracks in Dm between 120 and 130 bpm': 'faixas em Dm entre 120 e 130 bpm',
    'create a playlist of 10 ambient tracks from my library': 'criar uma lista com 10 faixas ambient da minha biblioteca',
    'What I can do': 'O que eu posso fazer',
    'Check for updates': 'Verificar atualizações', 'Check for updates...': 'Verificando atualizações...',
    'Update now': 'Atualizar agora', 'Up to date.': 'Atualizado.',
    'Checking...': 'Verificando...', 'Checking the endpoint...': 'Verificando o endpoint...',
    'Language': 'Idioma', 'Display name': 'Nome de exibição',
    'Email': 'E-mail', 'Timezone': 'Fuso horário', 'City': 'Cidade',
    'Genres you love': 'Gêneros que você gosta', 'Artists you love': 'Artistas que você gosta',
    'Usually listening': 'O que costuma ouvir', 'Keep out of picks': 'Manter fora das escolhas',
    'Save settings': 'Salvar ajustes', 'Repair metadata': 'Corrigir metadados',
    'Let children\'s music shape recommendations': 'Deixar músicas infantis influenciar as recomendações',
    'Base URL': 'URL base', 'Model': 'Modelo', 'API key': 'Chave da API',
    'Test connection': 'Testar conexão',
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
    [/\b(\d+) tracks\b/g, (m) => `${m[1]} ${m[1] === '1' ? 'faixa' : 'faixas'}`],
    [/\b(\d+) songs\b/g, (m) => `${m[1]} ${m[1] === '1' ? 'música' : 'músicas'}`],
    [/\b(\d+) playlists\b/g, (m) => `${m[1]} ${m[1] === '1' ? 'lista' : 'listas'}`],
    [/\bwithout cue points\b/g, () => 'sem cue points'],
    [/\bup to date\b/g, () => 'em dia'],
    [/\bnever analysed\b/g, () => 'nunca analisadas'],
    [/\bnever\b/g, () => 'nunca'],
    [/\bnot downloaded\b/g, () => 'não baixadas'],
    [/\bANALYSED\b/g, () => 'ANALISADAS'],
    [/^(\d+) playlists?, ready when you are\.$/, (m) => `${m[1]} ${Number(m[1]) === 1 ? 'lista' : 'listas'}, quando você quiser.`],
    [/^All (\d+) playlists$/, (m) => `Todas as ${m[1]} listas`],
    [/^You left off on /, () => 'Você parou em '],
    [/^Sources: /, () => 'Fontes: '],
    [/^Playback log: /, () => 'Registro de reprodução: '],
    [/^how much of my library has audio$/, () => 'quanto da minha biblioteca tem áudio'],
    [/^(\d+) tracks by (.+) I don't have$/, (m) => `${m[1]} faixas de ${m[2]} que não tenho`],
    [/^(\d+) (.+) tracks I don't have$/, (m) => `${m[1]} faixas de ${m[2]} que não tenho`],
    [/^(\d+) tracks in (.+) I don't have$/, (m) => `${m[1]} faixas em ${m[2]} que não tenho`],
    [/^(.+) I never played$/, (m) => `${m[1]} que nunca ouvi`],
    [/^tracks I have not played in months$/, () => 'faixas que não ouço há meses'],
    [/^tracks added this week$/, () => 'faixas adicionadas esta semana'],
    [/^tracks under 3 minutes$/, () => 'faixas com menos de 3 minutos'],
    [/^Download (\d+)$/, (m) => `Baixar ${m[1]}`],
    [/^(\d+) need analysis$/, (m) => `${m[1]} ${m[1] === '1' ? 'precisa' : 'precisam'} de análise`],
    [/^(\d+) turns automatic saving off\.$/, (m) => `${m[1]} ${m[1] === '1' ? 'desativa' : 'desativam'} o salvamento automático`],
    [/^(\d+) KB cached · (\d+) items$/, (m) => `${m[1]} KB em cache · ${m[2]} itens`],
    [/^Analyzing ([\d,]+) tracks in the background$/, (m) => `Analisando ${m[1]} faixas em segundo plano`],
    [/^Show listening \((\d+)\)$/, (m) => `Mostrar audição (${m[1]})`],
    [/^Hide listening \((\d+)\)$/, (m) => `Ocultar audição (${m[1]})`],
    [/^Analyse ([\d,]+) nunca analisadas$/, (m) => `Analisar ${m[1]} nunca analisadas`],
    [/^Analyse ([\d,]+) never analysed$/, (m) => `Analisar ${m[1]} nunca analisadas`],
    [/^Analyze ([\d,]+) nunca analisadas$/, (m) => `Analisar ${m[1]} nunca analisadas`],
    [/^Analyze ([\d,]+) never analysed$/, (m) => `Analisar ${m[1]} nunca analisadas`],
    [/^Prep (\d+)$/, (m) => `Preparar ${m[1]}`],
    [/^Update (\d+)$/, (m) => `Atualizar ${m[1]}`],
    [/^(\d+)\/(\d+) up to date$/, (m) => `${m[1]}/${m[2]} em dia`],
    [/^(\d+) without cue points$/, (m) => `${m[1]} sem cue points`],
    [/^(\d+) need cue points$/, (m) => `${m[1]} precisam de cue points`],
    [/^(\d+) never analysed$/, (m) => `${m[1]} nunca analisadas`],
    [/^(\d+) never$/, (m) => `${m[1]} nunca`],
    [/^(\d+)\/(\d+) audio$/, (m) => `${m[1]}/${m[2]} áudio`],
    [/^Done ([\d,]+)$/, (m) => `Concluído ${m[1]}`],
    [/^Prepping ([\d,]+)\/([\d,]+)$/, (m) => `Preparando ${m[1]}/${m[2]}`],
    [/^Re-analysing ([\d,]+)\/([\d,]+)$/, (m) => `Analisando novamente ${m[1]}/${m[2]}`],
    [/^Make (\d+) playable$/, (m) => `Tornar ${m[1]} reproduzíveis`],
  ];

  const SKIP = [
    '.tt', '.ta', '.tartist', '.talbum', '.talbum-line', '.tcard-name', '.tcard-sub',
    '.pcard-name', '.plhead-name', '.np-title', '.np-artist', '.np-album',
    '.crate-name', '.lrow-t b', '.crate-row-t b', '.mpick-t b', '.mast-name',
    '.album-chip b', '.q-title', '.q-sub', '.ai-said', '.ask-action-meta', '.avoid-term',
    '.genrechip', '.keychip', '.tno', '.tdur', '.tbpm', '.trbadge', '.tadded',
    'script', 'style', 'textarea',
  ].join(',');

  function isUserContent(node) {
    const el = node.parentElement;
    if (node.nodeValue && node.nodeValue.trim() === 'Liked Songs') return false;
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
