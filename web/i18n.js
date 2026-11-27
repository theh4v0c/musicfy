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
    // home
    'Flow': 'Flow', 'endless mix from what you play': 'mix sem fim com o que você ouve',
    'Your rotation': 'Sua rotação', 'ON DECK': 'NA FILA', 'SHUFFLE': 'ALEATÓRIO',
    'Recently played': 'Tocadas recentemente', 'Your playlists': 'Suas listas',
    'Fresh in your library': 'Novidades na sua biblioteca',
    'More from artists you play': 'Mais de artistas que você toca',
    'Not in any playlist': 'Fora de qualquer lista',
    'NOT YET HEARD': 'AINDA NÃO OUVIDAS', 'UNFILED': 'SEM LISTA',
    'NOT IN YOUR LIBRARY': 'NÃO ESTÁ NA SUA BIBLIOTECA',
    'Preview before downloading': 'Ouvir antes de baixar',
    'Nothing to surface yet. Add tracks or play a few, and this fills in.':
      'Nada para mostrar ainda. Adicione faixas ou toque algumas, e isto se preenche.',

    'Recently downloaded': 'Baixadas recentemente',
    'artist of the week, unheard lately': 'artista da semana, pouco ouvido',
    'your artist of the week, unheard lately': 'seu artista da semana, pouco ouvido',
    'more from': 'mais de', 'same key as': 'mesma tonalidade de',
    'in the library, never heard': 'na biblioteca, nunca ouvida',
    'untouched for two months': 'não tocada há dois meses',
    'you wore this one out, then forgot it': 'você ouviu demais e depois esqueceu',
    'no reason, it just slaps': 'sem motivo, só combina',
    'Morning,': 'Bom dia,', 'Afternoon,': 'Boa tarde,', 'Evening,': 'Boa noite,',
    'Late one,': 'Boa madrugada,', 'Deep in it,': 'Sessão longa,',
    'Morning.': 'Bom dia.', 'Afternoon.': 'Boa tarde.', 'Evening.': 'Boa noite.',
    'Late one.': 'Boa madrugada.', 'Deep in it.': 'Sessão longa.',
    'Ready when you are.': 'Quando você quiser.', 'Resume': 'Continuar', 'last track': 'última faixa',
    'All': 'Todas', 'TOTAL': 'TOTAL',
    'PLAY SOMETHING AND IT LANDS HERE': 'TOQUE ALGO E ELE APARECE AQUI',
    // library
    'Filter by title, artist or album': 'Filtrar por título, artista ou álbum',
    'Create playlist': 'Criar lista',
    'Downloaded': 'Baixadas', 'Not downloaded': 'Não baixadas',
    'Artists': 'Artistas', 'Albums': 'Álbuns', 'Genres': 'Gêneros',
    'Sort by BPM': 'Ordenar por BPM', 'Upload files': 'Subir arquivos',
    'Upload a folder': 'Subir uma pasta', 'Import track': 'Importar faixa',
    'For you': 'Para você', 'Import playlist': 'Importar lista',
    'Newest first': 'Mais recentes',
    'Oldest first': 'Mais antigas', 'Recently updated': 'Atualizadas recentemente',
    'Most tracks': 'Mais faixas', 'Least prepped': 'Menos preparadas',
    'Most prepped': 'Mais preparadas', 'Show listening': 'Mostrar audição',
    'Hide listening': 'Ocultar audição', 'Name Z-A': 'Nome Z-A',
    'Import Spotify playlist': 'Importar lista do Spotify', 'New playlist': 'Nova lista',
    'Upload track': 'Subir faixa', 'Playlist from most-played': 'Lista das mais tocadas',
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
    'PLAYLIST': 'LISTA', 'Playlist': 'Lista',
    'Listas': 'Listas', 'listening only': 'somente audição', 'no audio': 'sem áudio',
    'need analysis': 'precisa de análise', 'analysed, current': 'analisadas, atualizadas',
    'Harmonic': 'Harmônico', 'DJ set': 'Set de DJ', 'Listening': 'Audição',
    'EXPORT': 'EXPORTAR', 'EXPORT READY': 'PRONTAS PARA EXPORTAR',
    'The playlists you play out - BPM, key, beat grid and cue points ready to export. Listening playlists stay off this page.':
      'As listas que você toca - BPM, tonalidade, grade e cue points prontos para exportar. Listas de audição ficam fora desta página.',
    'Analyze unanalyzed': 'Analisar não analisadas', 'Make playable': 'Tornar reproduzível',
    'ready': 'pronta', 'Re-analyse': 'Analisar novamente',
    'Analyse every track again, including cue points': 'Analisar todas as faixas novamente, incluindo os cue points',
    'No DJ playlists yet. Mark a playlist as a DJ set to prep it.': 'Ainda não há listas de DJ. Marque uma lista como Set de DJ para prepará-la.',
    'this playlist is up to date': 'esta lista está em dia',
    'Prepping': 'Preparando', 'Re-analysing': 'Analisando novamente', 'Starting': 'Iniciando',
    'Analyzing...': 'Analisando...',
    'Every track with audio has been analysed at least once': 'Todas as faixas com áudio já foram analisadas pelo menos uma vez',
    'Upload tracks': 'Subir faixas', 'Edit album': 'Editar álbum',
    'Delete album': 'Excluir álbum', 'Choose tracks': 'Escolher faixas',
    'Playlist options': 'Opções da lista', 'Add to playlist': 'Adicionar à lista',
    'Remove from this playlist': 'Remover desta lista', 'Start track radio': 'Rádio desta faixa',
    'Play next': 'Tocar em seguida', 'Add to queue': 'Adicionar à fila',
    'Go to album': 'Ir para o álbum', 'Go to artist': 'Ir para o artista',
    'Download to device': 'Baixar para o aparelho',
    'Remove from offline': 'Remover do offline', 'Write Traktor tags': 'Gravar tags do Traktor',
    'Analyze BPM & key': 'Analisar BPM e tonalidade', 'Re-analyze': 'Analisar novamente',
    'Save to Liked Songs': 'Salvar em Curtidas',
    // search
    'Search tracks, artists and albums': 'Buscar faixas, artistas e álbuns',
    'INCLUDE': 'INCLUIR', 'Web sources': 'Fontes da web', 'Long sets': 'Sets longos',
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
    'Turns loud tracks down towards a common level, using the loudness measured during analysis. It only ever attenuates - it cannot add distortion and it never rewrites a file. iOS ignores per-track volume, so on a phone or in a car this does nothing.':
      'Reduz faixas altas para um nível comum, usando o volume medido na análise. Só atenua - não adiciona distorção e nunca reescreve um arquivo. O iOS ignora o volume por faixa, então no celular ou no carro isso não faz nada.',
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
    'create a playlist of 10 ambient tracks': 'criar uma lista com 10 faixas ambient',
    // fragments left after an inline <b> splits a stats line
    'plays recorded': 'reproduções registradas', 'current ·': 'atuais ·',
    'What I can do': 'O que eu posso fazer',
    'Check for updates': 'Verificar atualizações', 'Check for updates...': 'Verificando atualizações...',
    'Update now': 'Atualizar agora',
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
    'Nothing run yet.': 'Nada executado ainda.',
    // metadata dialog
    'Title': 'Título', 'Artist': 'Artista', 'Album': 'Álbum', 'Year': 'Ano',
    'Set album': 'Definir álbum', 'Set year': 'Definir ano',
    'Tick album or year first': 'Marque álbum ou ano primeiro',
    // status and toasts
    'Nothing playing': 'Nada tocando', 'Playing': 'Tocando', 'Paused': 'Pausado',
    'Saved': 'Salvo', 'Metadata saved': 'Metadados salvos', 'Renamed': 'Renomeado',
    'Removed from playlist': 'Removida da lista', 'Deleted': 'Excluída',
    'Could not save those changes': 'Não foi possível salvar as alterações',
    'Command palette': 'Paleta de comandos',
    'How do you use MUSICFY?': 'Como você usa o MUSICFY?',
    'DJ shows Prep, analysis, BPM and key. Listener keeps the library and playback only.':
      'DJ mostra Preparar, análise, BPM e tonalidade. Ouvinte mantém só a biblioteca e a reprodução.',
    'I am a DJ': 'Sou DJ', 'I am a listener': 'Sou ouvinte',
    'Switch to Listener mode': 'Mudar para o modo Ouvinte', 'Switch to DJ mode': 'Mudar para o modo DJ',
    'Export this playlist for Rekordbox': 'Exportar esta lista para o Rekordbox',
    'Export this playlist for Traktor': 'Exportar esta lista para o Traktor',
    'Could not save the mode': 'Não foi possível salvar o modo',

    'For you now': 'Para você agora', 'UPDATED IN THE BACKGROUND': 'ATUALIZADO EM SEGUNDO PLANO',
    'New picks': 'Novas sugestões', 'Choosing picks…': 'Escolhendo sugestões…',
 'Command palette (⌘K)': 'Paleta de comandos (⌘K)',
    'move': 'mover', 'run': 'executar', 'close': 'fechar', 'open': 'abrir',

    'Confirm': 'Confirmar', 'Could not copy the playback log': 'Não foi possível copiar o registro de reprodução',

    'Filter this library': 'Filtrar esta biblioteca', 'Search everywhere': 'Buscar em tudo',
    'Scope': 'Escopo', 'Both': 'Ambos', 'This library': 'Esta biblioteca',
    'A&R · describe a set': 'A&R · descreva um set',
 'Jump to a view, track or playlist': 'Ir para uma tela, faixa ou lista',
    'Play library shuffled': 'Tocar a biblioteca aleatória', 'Scan a folder': 'Escanear uma pasta',
    'No matches': 'Nada encontrado', 'Go': 'Ir', 'Track': 'Faixa',

    'PLAYING FROM': 'TOCANDO DE',
    'Describe a set, a filter or a question.': 'Descreva um set, um filtro ou uma pergunta.',
    'You see the plan and the tracks as a draft.': 'Você vê o plano e as faixas como rascunho.',
    'Nothing is saved or downloaded until you confirm.': 'Nada é salvo ou baixado até você confirmar.',
    'Tools': 'Ferramentas', 'IMPORT · SORT': 'IMPORTAR · ORDENAR',

    'settings': 'ajustes', 'name': 'nome', 'time zone': 'fuso horário', 'city': 'cidade',
    'model endpoint': 'endpoint do modelo', 'model': 'modelo',
    'format': 'formato', 'loudness switch': 'normalização', 'target level': 'nível alvo',
    'autoplay': 'continuação', 'buffer': 'buffer', 'genres': 'gêneros', 'artists': 'artistas',
    'listening context': 'contexto de audição', 'pick exclusions': 'exclusões',
    'children in taste': 'músicas infantis',
    'bad request body': 'corpo da requisição inválido', 'path required': 'caminho obrigatório',
    'q required': 'pergunta obrigatória',

    'IN CATALOGUE': 'NO CATÁLOGO', 'In the catalogue': 'No catálogo',
    'NEXT IN QUEUE': 'A SEGUIR NA FILA', 'NO MATCHES': 'SEM RESULTADOS',
    'NOW PLAYING': 'TOCANDO AGORA', 'Open web matches': 'Resultados da web',
    'SEARCHING SOURCES...': 'BUSCANDO FONTES...', 'Top result': 'Melhor resultado',
    'Finding a preview…': 'Buscando uma prévia…',
    'No owned tracks for this artist yet. Search the web and download some.':
      'Nenhuma faixa deste artista na biblioteca ainda. Busque na web e baixe algumas.',
    'No web sources available right now.': 'Nenhuma fonte web disponível agora.',
    'Nothing from this album is here yet. Use Download album to fetch the full tracklist.':
      'Nada deste álbum está aqui ainda. Use Baixar álbum para trazer a lista completa.',
    'Nothing liked yet. Heart something from any playlist.': 'Nada curtido ainda. Curta alguma faixa de qualquer lista.',
    'Nothing matches that filter.': 'Nada corresponde a esse filtro.',
    'Queue is empty. Right click any track to add.': 'A fila está vazia. Clique com o botão direito em qualquer faixa para adicionar.',
    'A Spotify link imports the playlist. Any other service needs its tracks pasted.':
      'Um link do Spotify importa a lista. Qualquer outro serviço precisa das faixas coladas.',
    'Download album': 'Baixar álbum', 'Back to songs': 'Voltar para as faixas',
    'Copy playback log': 'Copiar registro de reprodução', 'Playlist name': 'Nome da lista',
    'Spotify playlist link, or one track per line': 'Link da lista do Spotify, ou uma faixa por linha',
    'Excluded from picks, Flow, the rotation and the harmonic queue from now on.':
      'Fora das escolhas, do Flow, da rotação e da fila harmônica a partir de agora.',
    'tracks in your library': 'faixas na sua biblioteca', 'sources -': 'fontes -',
    'core unreachable:': 'servidor inacessível:',
    'Morning': 'Manhã', 'Afternoon': 'Tarde', 'Evening': 'Noite',
    'Late one': 'Da madrugada', 'Deep in it': 'Na sessão há horas',
    'Good morning.': 'Bom dia.', 'Good afternoon.': 'Boa tarde.',
    'Good evening.': 'Boa noite.', 'Good night.': 'Boa madrugada.',

    'Could not save': 'Não foi possível salvar', 'Nothing changed': 'Nada mudou',
    'Checking for updates...': 'Procurando atualizações...',
    'Checking the tracklist…': 'Conferindo a lista de faixas…',
    'Downloading…': 'Baixando…', 'Queueing…': 'Enfileirando…', 'Still downloading': 'Ainda baixando',
    'Retry download': 'Tentar o download de novo', 'No preview available.': 'Prévia indisponível.',
    'Saved, but that city was not found': 'Salvo, mas essa cidade não foi encontrada',
    'No open source has this audio yet. Use the download arrow on a catalogue row to fetch it.':
      'Nenhuma fonte aberta tem este áudio ainda. Use a seta de download numa linha do catálogo para buscar.',
    'That did not go through - try a plain phrase like “tracks between 120 and 130 BPM”.':
      'Isso não passou - tente uma frase simples como “faixas entre 120 e 130 BPM”.',

    'Could not update those tracks': 'Não foi possível atualizar essas faixas',
    // toast messages
    'Added to queue': 'Adicionada à fila', 'Playing next': 'Tocando em seguida',
    'Deleted from library': 'Excluída da biblioteca',
    'Download failed': 'Falha no download', 'Download is still running in the background': 'O download continua em segundo plano',
    'Queue restored': 'Fila restaurada', 'Radio failed': 'Rádio falhou', 'No radio available': 'Rádio indisponível',
    'No liked songs yet': 'Nenhuma música curtida ainda', 'Nothing selected': 'Nada selecionado',
    'Nothing to import': 'Nada para importar', 'Playlist is empty': 'A lista está vazia',
    'Buffer cleared': 'Buffer limpo', 'Cache cleared': 'Cache limpo', 'Cancelled': 'Cancelado',
    'Retrying': 'Tentando novamente', 'Analysis failed': 'Análise falhou', 'Cover updated': 'Capa atualizada',
    'Cover upload failed': 'Falha ao subir a capa', 'Delete failed': 'Falha ao excluir',
    'Import failed': 'Falha na importação', 'No audio files in item': 'Nenhum arquivo de áudio no item',
    'No audio files in that item': 'Nenhum arquivo de áudio nesse item', 'Repair failed': 'Falha na correção',
    'Sorted by harmonic key': 'Ordenado por tonalidade harmônica', 'That did not work': 'Isso não funcionou',
    'Upgrade is still running in the background': 'A melhoria continua em segundo plano',
    'Upgraded to a better copy': 'Melhorado para uma cópia superior',
    'No MP3s to tag in this playlist': 'Nenhum MP3 para marcar nesta lista',
    'No better copy found - your current file is the best available': 'Nenhuma cópia melhor - seu arquivo atual é o melhor disponível',
    'Nothing playable in the queue. Download some tracks first.': 'Nada reproduzível na fila. Baixe algumas faixas primeiro.',
    'Play a few tracks first so Flow can learn your taste': 'Toque algumas faixas primeiro para o Flow aprender seu gosto',
    'Choose Library or Web sources to search': 'Escolha Biblioteca ou Fontes da web para buscar',
    'Checking for duplicates': 'Verificando duplicatas', 'Building playlist from history': 'Criando lista a partir do histórico',
    'Building radio...': 'Criando rádio...', 'Building the zip, this can take a minute': 'Criando o ZIP, isso pode levar um minuto',
    'Fetching official album art': 'Buscando capa oficial do álbum', 'Looking up the track': 'Procurando a faixa',
    'Mirroring playlist...': 'Espelhando lista...', 'Repairing metadata…': 'Corrigindo metadados…',
    'Tagging genres from MusicBrainz, this runs in the background': 'Marcando gêneros no MusicBrainz, isso roda em segundo plano',
    'Everything with audio has been analysed at least once': 'Tudo com áudio já foi analisado pelo menos uma vez',
    'Those tracks were not uploaded again. Use "Find higher quality" to replace a copy.': 'Essas faixas não foram enviadas de novo. Use "Buscar qualidade melhor" para substituir uma cópia.',
    'Tags written. Open the file in Traktor to see BPM, key and cues.': 'Tags gravadas. Abra o arquivo no Traktor para ver BPM, tonalidade e cue points.',
    'Catalogue can correct this track now': 'O catálogo pode corrigir esta faixa agora',
    'Continuing with similar tracks': 'Continuando com faixas parecidas',
    'Could not build picks': 'Não foi possível montar as escolhas',
    'Could not change how this playlist is used': 'Não foi possível mudar o uso desta lista',
    'Could not change the mode': 'Não foi possível mudar o modo',
    'Could not find that track': 'Não foi possível encontrar essa faixa',
    'Could not order': 'Não foi possível ordenar',
    'Could not queue an upgrade': 'Não foi possível enfileirar uma melhoria',
    'Could not queue that album': 'Não foi possível enfileirar esse álbum',
    'Could not queue the album': 'Não foi possível enfileirar o álbum',
    'Could not queue upgrades': 'Não foi possível enfileirar melhorias',
    'Could not release the lock': 'Não foi possível liberar o bloqueio',
    'Could not reorder': 'Não foi possível reordenar',
    'Could not save for offline': 'Não foi possível salvar para offline',
    'Could not save that exclusion': 'Não foi possível salvar essa exclusão',
    'Could not save that like': 'Não foi possível salvar essa curtida',
    'Could not set that cover': 'Não foi possível definir essa capa',
    'Could not start': 'Não foi possível iniciar',
    'Could not start analysis': 'Não foi possível iniciar a análise',
    'Could not start cover repair': 'Não foi possível iniciar a correção de capas',
    'Could not start the conversion': 'Não foi possível iniciar a conversão',
    'Could not undo': 'Não foi possível desfazer',
    'Could not use that cover': 'Não foi possível usar essa capa',
    'Could not write tags': 'Não foi possível gravar as tags',
    'Deleted. It keeps playing until the end, then the queue continues.': 'Excluída. Continua tocando até o fim, depois a fila segue.',
    'Exclusion removed': 'Exclusão removida',
    'Flow failed': 'Falha no Flow',
    'Genre pass started': 'Passagem de gêneros iniciada',
    'Import failed: ': 'Falha na importação: ',
    'Listening playlist created - switch it to DJ set when you want it prepped': 'Lista de audição criada - mude para Set de DJ quando quiser prepará-la',
    'Missing tracks stay hidden until you clear this': 'Faixas ausentes ficam ocultas até você limpar isto',
    'No genres tagged yet. Press Fill genres first.': 'Nenhum gênero marcado ainda. Use Preencher gêneros primeiro.',
    'No track in this crate has artwork yet': 'Nenhuma faixa desta lista tem capa ainda',
    'None of these have audio yet': 'Nenhuma destas tem áudio ainda',
    'Offline playback needs HTTPS - open the https:// URL': 'Reprodução offline precisa de HTTPS - abra a URL https://',
    'Only Spotify links import directly. Paste the track list for other services.': 'Somente links do Spotify importam diretamente. Cole a lista de faixas de outros serviços.',
    'Playlist cover updated': 'Capa da lista atualizada',
    'Playlist deleted. Tracks are still in Songs.': 'Lista excluída. As faixas continuam na Biblioteca.',
    'Remove failed': 'Falha ao remover',
    'Several tracks could not play': 'Várias faixas não puderam tocar',
    'That draft went stale, ask again': 'Esse rascunho expirou, peça novamente',
    'archive lookup failed': 'falha na busca no archive',
    'cancel failed': 'falha ao cancelar',
    'could not clear': 'não foi possível limpar',
    'could not queue': 'não foi possível enfileirar',
    'could not queue downloads': 'não foi possível enfileirar downloads',
    'could not start genre pass': 'não foi possível iniciar a passagem de gêneros',
    'cover lookup failed': 'falha na busca de capa',
    'dedupe failed': 'falha ao remover duplicatas',
    'download failed': 'falha no download',
    'import failed': 'falha na importação',
    'no play path for this source': 'nenhum caminho de reprodução para esta fonte',
    'no soundcloud url': 'sem URL do SoundCloud',
    'retry failed': 'falha ao tentar novamente',
    'setting failed': 'falha ao salvar a configuração',
    'stream refused': 'transmissão recusada',
    // server error messages, shown through a toast
    'a playlist needs a name': 'a lista precisa de um nome',
    'album name required': 'o nome do álbum é obrigatório',
    'title required': 'o título é obrigatório',
    'order required': 'a ordem é obrigatória',
    'ids required': 'os IDs são obrigatórios',
    'query too short': 'a busca é curta demais',
    'nothing to import': 'nada para importar',
    'nothing to change': 'nada para mudar',
    'non-soundcloud url': 'URL que não é do SoundCloud',
    'not found': 'não encontrado',
    'no such track': 'essa faixa não existe',
    'no such playlist': 'essa lista não existe',
    'no such album': 'esse álbum não existe',
    'no such job': 'essa tarefa não existe',
    'no track': 'nenhuma faixa',
    'no file': 'nenhum arquivo',
    'no file for this track': 'nenhum arquivo para esta faixa',
    'no preview source': 'nenhuma fonte de prévia',
    'empty upload': 'envio vazio',
    'unsupported file type': 'tipo de arquivo não suportado',
    'that track has no cover': 'essa faixa não tem capa',
    'that image could not be read': 'não foi possível ler essa imagem',
    'that is a single track. Use its download button instead.': 'isso é uma faixa única. Use o botão de download dela.',
    'the server could not complete that request': 'o servidor não conseguiu concluir esse pedido',
    'this install is not a git checkout': 'esta instalação não é um repositório git',
    'This install is not a git checkout; update from a release bundle.': 'Esta instalação não é um repositório git; atualize por um pacote de versão.',
    // downloads drawer
    'Close downloads': 'Fechar downloads',
    'Nothing in the queue.': 'Nada na fila.',
    'waiting': 'aguardando', 'no source': 'sem fonte', 'failed': 'falhou',
    'Reading the library…': 'Lendo a biblioteca…',
    'Nothing is missing.': 'Não falta nada.',
    'Could not read the list.': 'Não foi possível ler a lista.',
    'Hide the list': 'Ocultar a lista', 'Not now': 'Agora não',
    'Queued': 'Na fila', 'Failed': 'Falhou',
    'catalogue-only': 'só no catálogo',
    // track and playlist menus
    'Change cover': 'Trocar capa', 'Use this cover for a playlist': 'Usar esta capa numa lista',
    'Let catalogue fix metadata': 'Deixar o catálogo corrigir',
    'Remove from Liked Songs': 'Remover das Curtidas',
    'Download this track': 'Baixar esta faixa',
    'Save for offline': 'Salvar para offline',
    'Rename': 'Renomear',
    "Use a track's cover": 'Usar a capa de uma faixa',
    'Fix metadata (crate)': 'Corrigir metadados (lista)',
    'Fix album covers (crate)': 'Corrigir capas dos álbuns (lista)',
    'Find higher quality (crate)': 'Buscar qualidade melhor (lista)',
    'Export M3U': 'Exportar M3U',
    'Export for Rekordbox (.xml)': 'Exportar para Rekordbox (.xml)',
    'Export for Traktor (.nml)': 'Exportar para Traktor (.nml)',
    'Export for CDJ USB': 'Exportar para USB de CDJ',
    'Write Traktor tags (crate)': 'Gravar tags do Traktor (lista)',
    'Download to device (zip)': 'Baixar para o aparelho (zip)',
    'Catalogue country': 'País do catálogo',
    'Library folder': 'Pasta da biblioteca',
    'Point at a folder you already have. The files stay where they are: nothing is copied, moved or renamed. Playlists written by Traktor, rekordbox, M3U or PLS are imported with their order, and the BPM and key they already carry are kept.':
      'Aponte para uma pasta que você já tem. Os arquivos ficam onde estão: nada é copiado, movido ou renomeado. Listas do Traktor, rekordbox, M3U ou PLS entram com a ordem, e o BPM e a tonalidade que elas já trazem são mantidos.',
    'Folder or playlist file': 'Pasta ou arquivo de lista',
    'Scan folder': 'Escanear pasta',
    'Choose folder': 'Escolher pasta',
    'Music folder': 'Pasta de músicas',
    'Choose a folder…': 'Escolher uma pasta…',
    'Other folder…': 'Outra pasta…',
    'Choose a folder first.': 'Escolha uma pasta primeiro.',
    // first run
    'Skip setup': 'Pular configuração',
    'Continue': 'Continuar',
    'Come in': 'Pode entrar',
    'Open my library': 'Abrir minha biblioteca',
    'Ready': 'Pronto',
    'READY': 'PRONTO',
    'Setup done.': 'Configuração concluída.',
    'Run setup again': 'Refazer a configuração',
    'Name, place, mode and music folder, in five steps.': 'Nome, lugar, modo e pasta de músicas, em cinco passos.',
    'Stays on this computer. No account, no upload.': 'Fica neste computador. Sem conta, sem envio.',
    'Your music. Not a rental.': 'Sua música. Não é aluguel.',
    'No account, no cloud, no “Sign in with Google”. It runs on this computer, from files that are already on it. Skip whatever you like: none of this is a contract.':
      'Sem conta, sem nuvem, sem “Entrar com Google”. Roda neste computador, com arquivos que já estão nele. Pule o que quiser: nada aqui é contrato.',
    'Reads the folders you already have. It does not reorganise them.':
      'Lê as pastas que você já tem. Não reorganiza nada.',
    'Settings, plays and history stay on this computer.': 'Ajustes, reproduções e histórico ficam neste computador.',
    'Nothing is uploaded. A download happens when you ask for one, which is the whole idea.':
      'Nada é enviado. Download só acontece quando você pede, que é justamente a ideia.',
    'Your data lives in': 'Seus dados ficam em',
    'YOU': 'VOCÊ',
    'What should I call you?': 'Como devo te chamar?',
    'The greeting uses it, and nothing else does. Leave it empty and it will address you like a bank statement.':
      'A saudação usa isso, e mais nada. Deixe em branco e ele vai te tratar como extrato bancário.',
    'Your name': 'Seu nome',
    'A name, or nothing': 'Um nome, ou nada',
    'PLACE': 'LUGAR',
    'Where are you, roughly?': 'Onde você está, mais ou menos?',
    'So it says good evening at the right hour. The city is looked up once, right now, for coordinates and time zone, and then it stays here. Leave it blank and live in UTC like a server.':
      'Para dar boa noite na hora certa. A cidade é consultada uma vez, agora, para coordenadas e fuso, e depois fica aqui. Deixe em branco e viva em UTC como um servidor.',
    'MODE': 'MODO',
    'How do you listen?': 'Como você ouve?',
    'This changes the whole app, not a theme. Switch it later if you change your mind.':
      'Isso muda o app inteiro, não é tema. Dá para trocar depois, se mudar de ideia.',
    'Prep, BPM and key, harmonic mixing, CDJ exports. For sets that have to hold together.':
      'Preparação, BPM e tonalidade, mixagem harmônica, exportação para CDJ. Para sets que precisam se sustentar.',
    'Library, playlists, playback. Prep and analysis stay out of sight, along with the homework.':
      'Biblioteca, listas e reprodução. Preparação e análise ficam fora de vista, junto com o dever de casa.',
    'MUSIC': 'MÚSICA',
    'Where does the music live?': 'Onde a música mora?',
    'Point at a folder. The files stay where they are; this reads them in place. Nothing is copied, and nothing is uploaded to a service that will lose interest in two years.':
      'Aponte para uma pasta. Os arquivos ficam onde estão; isto lê no lugar. Nada é copiado, nem enviado para um serviço que vai perder o interesse em dois anos.',
    'A folder inside Music works best. Nothing is moved.': 'Uma pasta dentro de Músicas funciona melhor. Nada é movido.',
    'This server has no folder to offer. Add one later in Settings.':
      'Este servidor não tem pasta para oferecer. Adicione uma depois em Ajustes.',
    'Reading the folder…': 'Lendo a pasta…',
    'Looking up the city…': 'Procurando a cidade…',
    'Could not find that city. The hour will use this computer’s time zone.':
      'Não encontrei essa cidade. A hora usa o fuso deste computador.',
    'Could not read that folder:': 'Não foi possível ler essa pasta:',
    'Everything you just told it lives on this computer, in a folder you could delete if you changed your mind. There is no account to cancel.':
      'Tudo o que você acabou de dizer fica neste computador, numa pasta que você poderia apagar se mudasse de ideia. Não existe conta para cancelar.',
    'Repeatable: Settings → You → Run setup again.': 'Dá para repetir: Ajustes → Você → Refazer a configuração.',
    'An empty library, for now.': 'Uma biblioteca vazia, por enquanto.',
    // kids
    'Leave': 'Sair',
    'Kids': 'Kids',
    'Tap a list to play it.': 'Toque numa lista para tocar.',
    'Lists': 'Listas',
    'Anyone else?': 'Mais alguém?',
    'Just me': 'Só eu',
    'A kid or teenager': 'Uma criança ou adolescente',
    'Kids mode keeps their playlists apart and their plays out of your taste. The PIN that guards the exit is in Settings, under Kids.':
      'O modo Kids mantém as listas deles separadas e as reproduções fora do seu gosto. O PIN que protege a saída fica em Ajustes, em Kids.',
    'Their name': 'O nome',
    'Optional': 'Opcional',
    'Age': 'Idade',
    'Not set': 'Não definida',
    'No playlists yet.': 'Nenhuma lista ainda.',
    'Factory reset': 'Redefinir de fábrica',
    'Factory reset? Settings, playlists and the library index are cleared. Audio files on disk are kept.':
      'Redefinir de fábrica? Ajustes, listas e o índice da biblioteca são apagados. Os arquivos de áudio no disco ficam.',
    'This cannot be undone. Reset now?': 'Isso não pode ser desfeito. Redefinir agora?',
    'Reset. Reloading…': 'Redefinido. Recarregando…',
    'Could not reset:': 'Não foi possível redefinir:',
    'A scan adds to the library. It does not forget the folders you scanned before.':
      'Um escaneamento adiciona à biblioteca. Ele não esquece as pastas escaneadas antes.',
    'Up to 6': 'Até 6',
    '7 to 10': '7 a 10',
    '11 to 14': '11 a 14',
    '15 and up': '15 ou mais',
    'Nothing here yet.': 'Nada aqui ainda.',
    'A grown-up can mark playlists with “Use in Kids Mode” from their menu.':
      'Um adulto pode marcar listas com “Usar no modo Kids” no menu delas.',
    'Use in Kids Mode': 'Usar no modo Kids',
    'Remove from Kids Mode': 'Tirar do modo Kids',
    'Could not open Kids mode': 'Não foi possível abrir o modo Kids',
    'PIN to leave Kids mode': 'PIN para sair do modo Kids',
    'That PIN is not right.': 'Esse PIN não está certo.',
    'Playlist added to Kids mode': 'Lista adicionada ao modo Kids',
    'Playlist removed from Kids mode': 'Lista removida do modo Kids',
    'Could not change Kids mode': 'Não foi possível mudar o modo Kids',
    'A separate shelf for a kid or a teenager. Plays made in Kids mode are recorded on their own and never reach your taste, your rotation, your play history or A&R.':
      'Uma prateleira separada para uma criança ou adolescente. Reproduções no modo Kids ficam registradas à parte e nunca chegam ao seu gosto, à sua rotação, ao seu histórico ou ao A&R.',
    'No playlist is in Kids mode yet.': 'Nenhuma lista está no modo Kids ainda.',
    'Playlists in Kids mode:': 'Listas no modo Kids:',
    'Mark one with “Use in Kids Mode” from its menu, and the Kids entry appears in the sidebar.':
      'Marque uma com “Usar no modo Kids” no menu dela, e a entrada Kids aparece na barra lateral.',
    'Save PIN': 'Salvar PIN',
    'Clear PIN': 'Remover PIN',
    'PIN set': 'PIN definido',
    'PIN cleared': 'PIN removido',
    'A PIN is a speed bump for a child, not a lock: anyone who can reach this screen can clear it.':
      'Um PIN é um obstáculo para uma criança, não uma fechadura: quem chegar a esta tela pode removê-lo.',
    'MUSICFY plays files you already own. Add a folder with ⌘O, or download one track, and the page has something to say.':
      'O MUSICFY toca arquivos que você já tem. Adicione uma pasta com ⌘O, ou baixe uma faixa, e a página tem o que dizer.',
    'MUSICFY plays files you already own. Add a folder in Settings → Library folder, or download one track, and the page has something to say.':
      'O MUSICFY toca arquivos que você já tem. Adicione uma pasta em Ajustes → Pasta de músicas, ou baixe uma faixa, e a página tem o que dizer.',
    'Load models': 'Carregar modelos',
    'Loading…': 'Carregando…',
    'Models listed. Pick one from the field, or keep typing.':
      'Modelos listados. Escolha um no campo ou continue digitando.',
    'This endpoint does not list models:': 'Este endpoint não lista modelos:',
    'This endpoint does not list models. Type the name.':
      'Este endpoint não lista modelos. Digite o nome.',
    'Could not list models:': 'Não foi possível listar os modelos:',
    'Not scanned yet.': 'Ainda não escaneada.',
    'A track removed from the library later leaves its file on disk. Nothing here writes to your files.':
      'Uma faixa removida da biblioteca depois deixa o arquivo no disco. Nada aqui grava nos seus arquivos.',
    'Type a folder or a playlist file first.': 'Digite uma pasta ou um arquivo de lista primeiro.',
    'Looking at the folder...': 'Olhando a pasta...',
    'added one': 'adicionada', 'added many': 'adicionadas',
    'already here one': 'já estava aqui', 'already here many': 'já estavam aqui',
    'known one': 'conhecida', 'known many': 'conhecidas',
    'missing one': 'faltando', 'missing many': 'faltando',
    'playlist one': 'lista', 'playlist many': 'listas',
    'Scan stopped:': 'Escaneamento parou:', 'files read': 'arquivos lidos', 'nothing new': 'nada novo',
    'Could not scan:': 'Não foi possível escanear:',
    'Continent/City': 'Continente/Cidade', 'Your city': 'Sua cidade',
    'Genres, comma separated': 'Gêneros separados por vírgula',
    'Artists, comma separated': 'Artistas separados por vírgula',
    'When you listen': 'Quando você ouve', 'Genres to keep out': 'Gêneros a evitar',
    'Artist - Title': 'Artista - Título',

    'A scan from another machine needs MUSICFY_MUSIC_ROOTS set on the server.':
      'Um escaneamento a partir de outra máquina precisa de MUSICFY_MUSIC_ROOTS definido no servidor.',


    'LIBRARY': 'BIBLIOTECA', 'SEARCH': 'BUSCAR', 'SETTINGS': 'AJUSTES',

    'Every track you own, with the audio state and the filters that matter.': 'Todas as faixas que você tem, com o estado do áudio e os filtros que importam.',
    'Listening lists and DJ sets, ordered and ready to open.': 'Listas de audição e sets de DJ, ordenados e prontos para abrir.',
    'Your library and the open web, resolved before anything plays.': 'Sua biblioteca e a web aberta, resolvidas antes de qualquer reprodução.',
    'You, the library, the model endpoint and how downloads behave.': 'Você, a biblioteca, o endpoint do modelo e como os downloads se comportam.',
    'Describe what you want; it builds a draft before anything is saved.': 'Descreva o que você quer; ele monta um rascunho antes de salvar qualquer coisa.',

    'Describe what you want: a playlist, a filter or a question': 'Descreva o que você quer: uma lista, um filtro ou uma pergunta',
    'create a playlist of 20 tracks': 'criar uma lista com 20 faixas',
    'tracks between 120 and 130 BPM': 'faixas entre 120 e 130 BPM',
    'what can you do': 'o que você pode fazer',

    'Two letters. The catalogue differs by country: a release in Brazil can be missing from the US store. Empty follows the country of the city above. Set it while travelling when you want another storefront; Deezer is queried too, so the answer does not depend on one store.':
      'Duas letras. O catálogo muda por país: um lançamento no Brasil pode faltar na loja dos EUA. Em branco segue o país da cidade acima. Defina ao viajar quando quiser outra loja; o Deezer também é consultado, então a resposta não depende de uma só loja.',

    'Up to date.': 'Em dia.',
    'Restart now': 'Reiniciar agora', 'Restarting…': 'Reiniciando…',
    'Loading': 'Carregando', 'Buffering': 'Carregando áudio', 'Reconnecting': 'Reconectando',
    // dialogs and chrome the audit flagged
    'Write Traktor + ID3 tags into the file?': 'Gravar tags do Traktor + ID3 no arquivo?',
    'A .mf.bak backup is kept once.': 'Um backup .mf.bak é mantido uma vez.',
    'Apply these corrections?': 'Aplicar estas correções?',
    'Write Traktor + ID3 tags into': 'Gravar tags do Traktor + ID3 em',
    'file(s)?': 'arquivo(s)?',
    'A .mf.bak backup is kept once per file.': 'Um backup .mf.bak é mantido por arquivo.',
    'have no cue data at the current analyser. Cues will be missing. Export anyway?': 'não têm cue data no analisador atual. Os cues vão faltar. Exportar mesmo assim?',
    'The best copy is kept, playlists and likes move to it, and the extra files are deleted from disk.': 'A melhor cópia fica, listas e curtidas passam para ela, e os arquivos extras são apagados do disco.',
    'Playlist name for the selection:': 'Nome da lista para a seleção:',
    'in': 'em', 'and': 'e',
    'Hide sidebar': 'Ocultar barra lateral', 'Show sidebar': 'Mostrar barra lateral',
    'Track options': 'Opções da faixa', 'View': 'Visualização', 'List': 'Lista', 'Grid': 'Grade',
    'Compact': 'Compacta', 'Seek': 'Buscar posição',
    'Metadata only. Press the download icon to get the audio.': 'Só metadados. Use o ícone de download para baixar o áudio.',
    'Press Enter to search': 'Pressione Enter para buscar', 'Searching': 'Buscando',
    'Sort playlists': 'Ordenar listas', 'Start Flow': 'Iniciar o Flow',
    'On deck': 'A seguir', 'shuffle': 'aleatório',

    'Next track': 'Próxima faixa', 'Nothing to build from this one.': 'Nada para montar com isto.',
    'listening': 'em audição', 'Undo': 'Desfazer',


    'Updated. Restarting…': 'Atualizado. Reiniciando…',
    'Updated; MUSICFY is restarting': 'Atualizado; o MUSICFY está reiniciando',
    'Update pulled; restart MUSICFY to apply it': 'Atualização baixada; reinicie o MUSICFY para aplicar',
    'Update MUSICFY now? The new version is downloaded first; a restart is needed before it is active.':
      'Atualizar o MUSICFY agora? A nova versão é baixada primeiro; é preciso reiniciar para ela valer.',

    'For a stop in the car: what the phone and the server saw': 'Para uma parada no carro: o que o celular e o servidor viram',
    'Playback log copied': 'Registro de reprodução copiado',
    'Copy the playback log': 'Copie o registro de reprodução',

    'Delete playlist': 'Excluir lista', 'Keep it': 'Manter',
    'Search this artist': 'Buscar este artista',
    'Play now': 'Tocar agora', 'Add to playlist (stream)': 'Adicionar à lista (streaming)',
    'Download to library': 'Baixar para a biblioteca',

    'Download their latest album': 'Baixar o álbum mais recente',

    // prompts and confirmations
    'Playlist name:': 'Nome da lista:', 'New playlist name:': 'Nome da nova lista:',
    'Rename playlist:': 'Renomear lista:',
    'Paste a Spotify playlist link or ID:': 'Cole o link ou o ID de uma lista do Spotify:',
    'Paste a Spotify track link or ID:': 'Cole o link ou o ID de uma faixa do Spotify:',
    'Playlist name for your most played tracks:': 'Nome da lista com as suas faixas mais tocadas:',
    'From your history': 'Do seu histórico',
    'Tracks stay in your library.': 'As faixas continuam na sua biblioteca.',
    'Merge duplicate tracks? The best quality copy is kept and playlists, likes and plays move to it.': 'Juntar faixas duplicadas? A cópia de melhor qualidade fica, e listas, curtidas e reproduções passam para ela.',
    'Replace album covers with the official artwork? This overwrites existing covers for albums with more than one track.': 'Substituir as capas pela arte oficial? Isso sobrescreve as capas atuais dos álbuns com mais de uma faixa.',
    'Update MUSICFY now? The code is pulled first; a restart is needed before the new version is active.': 'Atualizar o MUSICFY agora? O código é baixado primeiro; é preciso reiniciar para a nova versão valer.',
    // A&R draft card
    'Nothing is saved until you pick one.': 'Nada é salvo até você escolher.',
    'Playlist only': 'Somente a lista', 'Download missing': 'Baixar faltantes',
    'Done': 'Pronto',
    'new': 'nova', 'missing': 'faltando',
    // settings purpose notes
    'The first word is used by the greeting on Home. Nothing else reads it.': 'A primeira palavra aparece na saudação da tela inicial. Nada mais usa isso.',
    'IANA name, e.g. America/Sao_Paulo. Drives the greeting hour, the "at this hour you usually listen" line and the weather. Setting a city below fills it in automatically.': 'Nome IANA, por exemplo America/Sao_Paulo. Define a hora da saudação, a linha "nesta hora você costuma ouvir" e o clima. Definir uma cidade abaixo preenche isso automaticamente.',
    'The interface language for this browser. Names of tracks, artists and playlists are never translated.': 'O idioma da interface neste navegador. Nomes de faixas, artistas e listas nunca são traduzidos.',
    'Repair metadata reads the audio tags and asks MusicBrainz for what is missing. Fill genres tags one genre per artist and a family for picks. Fix covers fetches album art for albums with none. Remove duplicates deletes a file only when it is the same recording; a remix, a live take or a different bitrate stays. Clear cache drops what the browser and the app keep for speed, never the library.': 'Corrigir metadados lê as tags do áudio e pede ao MusicBrainz o que falta. Preencher gêneros marca um gênero por artista e uma família para as escolhas. Corrigir capas baixa a arte dos álbuns que não têm. Remover duplicatas apaga um arquivo só quando é a mesma gravação; remix, versão ao vivo ou outra taxa ficam. Limpar cache descarta o que o navegador e o app guardam para velocidade, nunca a biblioteca.',
    'A streamed track with no file is downloaded after this many plays. 0 turns automatic saving off.': 'Uma faixa ouvida por streaming e sem arquivo é baixada depois desse número de reproduções. 0 desliga o salvamento automático.',
    'A language model turns one sentence into a structured request: key, BPM, year, genre, plays, count and order. MUSICFY sends the sentence and nothing else - never your library, your files or your listening history.': 'Um modelo de linguagem transforma uma frase em um pedido estruturado: tonalidade, BPM, ano, gênero, reproduções, quantidade e ordem. O MUSICFY envia a frase e nada mais - nunca sua biblioteca, seus arquivos ou seu histórico.',
    'Two callers only. A&R uses it when the request is a brief: a person, an age, an occasion, several likes ("a birthday set for a 7 year old who loves dinosaurs"). Ask uses it when the question is fuzzy ("something darker", "less vocals"). Everything else - genres, keys, tempo, years, counts - is parsed by the built-in rules, without a network call.': 'Só dois usos. O A&R usa quando o pedido é um briefing: uma pessoa, uma idade, uma ocasião, vários gostos ("um set de aniversário para uma criança de 7 anos que ama dinossauros"). O Ask usa quando a pergunta é vaga ("algo mais escuro", "menos vocais"). Todo o resto - gêneros, tonalidades, tempo, anos, contagens - é lido pelas regras internas, sem chamada de rede.',
    'Without an endpoint both fall back to those rules, which cover the explicit requests and miss the conversational ones. Covers, metadata, search inside your library, downloads and playback never use it.': 'Sem um endpoint, os dois voltam para essas regras, que cobrem os pedidos explícitos e perdem os conversacionais. Capas, metadados, busca na sua biblioteca, downloads e reprodução nunca usam o modelo.',
    'Applies to downloads from streaming sources only. "Keep the original" stores what the source serves without re-encoding. m4a and mp3 convert only when the source uses a different codec; when the source already serves AAC, m4a is a container fix with no re-encode. Files you upload are stored byte for byte, and lossless files are never converted.': 'Vale só para downloads de fontes de streaming. "Manter o original" guarda o que a fonte entrega sem reconverter. m4a e mp3 só convertem quando a fonte usa outro codec; quando a fonte já entrega AAC, o m4a é só um ajuste de contêiner, sem reconverter. Arquivos que você sobe são guardados byte a byte, e arquivos sem perda nunca são convertidos.',
    'Target level is the loudness every track is turned down to while Normalize is on. -14 dB matches the streaming services; -18 dB leaves more headroom for a DJ set.': 'O nível alvo é o volume para o qual toda faixa é reduzida com a normalização ligada. -14 dB acompanha os serviços de streaming; -18 dB deixa mais margem para um set de DJ.',
    'Buffer ahead keeps the next track preloaded. More buffer means no wait between tracks and more data held in memory; off frees the memory on a small device.': 'Pré-carregar mantém a próxima faixa pronta. Mais buffer significa não esperar entre faixas e mais dados na memória; desligado libera memória em aparelhos pequenos.',
    'Read-only counts: tracks, disk use, plays recorded and how many tracks have cue points.': 'Números só de leitura: faixas, uso de disco, reproduções registradas e quantas faixas têm cue points.',
    'Musical (Am, F#m)': 'Musical (Am, F#m)', 'Wheel values (8A, 11A)': 'Valores da roda (8A, 11A)',
    'Repair metadata reads the tags and fills title, artist, album, year and track number from MusicBrainz.': 'Corrigir metadados lê as tags e preenche título, artista, álbum, ano e número da faixa pelo MusicBrainz.',
    'Fill genres tags one genre per artist and a family, which is what picks and Flow use.': 'Preencher gêneros marca um gênero por artista e uma família, que é o que as escolhas e o Flow usam.',
    'Fix covers fetches album art for albums that have none; existing covers are kept.': 'Corrigir capas baixa a arte dos álbuns que não têm; as capas existentes ficam.',
    'Remove duplicates deletes a file only when it is the same recording; a remix, a live take or another bitrate stays.': 'Remover duplicatas apaga um arquivo só quando é a mesma gravação; remix, versão ao vivo ou outra taxa ficam.',
    'Clear cache drops covers, previews and pages kept for speed. No audio file is touched.': 'Limpar cache descarta capas, prévias e páginas guardadas para velocidade. Nenhum arquivo de áudio é tocado.',
    'model name': 'nome do modelo', 'not set': 'não definido',
    'stored, leave blank to keep': 'guardada, deixe em branco para manter',

    '-12 dB (loud)': '-12 dB (alto)', '-14 dB (default)': '-14 dB (padrão)', '-18 dB (quiet)': '-18 dB (baixo)',

    'never in picks': 'nunca nas escolhas', 'unknown error': 'erro desconhecido',
    'empty response': 'resposta vazia',
    'nothing downloaded in this playlist yet': 'nada baixado nesta lista ainda',
    'only a catalogue image can be used here': 'só uma imagem do catálogo pode ser usada aqui',
    'Spotify did not return that playlist. It may be private, or the link is not a playlist.': 'O Spotify não retornou essa lista. Ela pode ser privada, ou o link não é de uma lista.',
  };

  const patterns = [
    [/^(\d+) tracks$/, (m) => `${m[1]} faixas`],
    [/^(\d+) tracks · (\d+) local · (\d+) new$/, (m) => `${m[1]} faixas · ${m[2]} locais · ${m[3]} novas`],
    [/^(\d+) track$/, (m) => `${m[1]} faixa`],
    [/^(\d+) songs$/, (m) => `${m[1]} músicas`],
    [/^(\d+) song$/, (m) => `${m[1]} música`],
    [/^(\d+) playlists$/, (m) => `${m[1]} listas`],
    [/^(\d+) playlist$/, (m) => `${m[1]} lista`],
    [/^(\d+) playlists?, ready when you are\.$/, (m) => `${m[1]} ${Number(m[1]) === 1 ? 'lista' : 'listas'}, quando você quiser.`],
    [/^All (\d+) playlists$/, (m) => `Todas as ${m[1]} listas`],
    [/^You left off on /, () => 'Você parou em '],
    [/^more from (.+)$/, (m) => `mais de ${m[1]}`],
    [/^Play “(.+)”$/, (m) => `Tocar “${m[1]}”`],
    [/^Shuffle “(.+)”$/, (m) => `Aleatório “${m[1]}”`],

    [/^(\d+) tracks? · listening$/, (m) => `${m[1]} ${m[1] === '1' ? 'faixa' : 'faixas'} · em audição`],
    [/^(\d+) tracks? · listening only$/, (m) => `${m[1]} ${m[1] === '1' ? 'faixa' : 'faixas'} · só para audição`],

    [/^Saved · (\d+) settings$/, (m) => `Salvo · ${m[1]} ajustes`],
    [/^Saved · (.+)$/, (m) => `Salvo · ${m[1]}`],

    [/^Show all (\d+) albums$/, (m) => `Ver todos os ${m[1]} álbuns`],
    [/^No usable matches for "(.+)"$/, (m) => `Nenhum resultado utilizável para “${m[1]}”`],
    [/^resolving "(.+)" across youtube, soundcloud and archive$/i, (m) => `resolvendo “${m[1]}” no youtube, soundcloud e archive`],
    [/^(\d+) families · (\d+) of (\d+) tracks$/, (m) => `${m[1]} famílias · ${m[2]} de ${m[3]} faixas`],
    [/^Add (\d+) to playlist$/, (m) => `Adicionar ${m[1]} à lista`],

    [/^Because you play (.+)$/, (m) => `Porque você toca ${m[1]}`],

    [/^same key as (.+)$/, (m) => `mesma tonalidade de ${m[1]}`],
    [/^(\d+) BPM, never played$/, (m) => `${m[1]} BPM, nunca tocada`],
    [/^(.+) on disk$/, (m) => `${m[1]} no disco`],
    [/^([\d.,]+) TRACKS$/, (m) => `${m[1]} ${m[1] === '1' ? 'FAIXA' : 'FAIXAS'}`],
    [/^Show all ([\d.,]+)$/, (m) => `Ver todas as ${m[1]}`],
    [/^(\d+) of (\d+) tracks have audio \((\d+)%\)$/, (m) => (m[2] === '1' ? `${m[1]} de 1 faixa tem áudio` : `${m[1]} de ${m[2]} faixas têm áudio`) + ` (${m[3]}%)`],
    [/^(\d+) running$/, (m) => `${m[1]} baixando`],
    [/^(\d+) queued$/, (m) => `${m[1]} na fila`],
    [/^(\d+) failed$/, (m) => `${m[1]} falharam`],
    [/^(\d+) catalogue-only$/, (m) => `${m[1]} só no catálogo`],
    [/^Retry all failed \((\d+)\)$/, (m) => `Tentar todas as falhas (${m[1]})`],
    [/^Cancel all \((\d+)\)$/, (m) => `Cancelar tudo (${m[1]})`],
    [/^Dismiss failed \((\d+)\)$/, (m) => `Descartar falhas (${m[1]})`],
    [/^See the (\d+) missing$/, (m) => `Ver as ${m[1]} faltando`],
    [/^Fill (\d+) missing tracks?$/, (m) => `Baixar ${m[1]} ${m[1] === '1' ? 'faixa faltando' : 'faixas faltando'}`],
    [/^(\d+) downloads? cancelled$/, (m) => `${m[1]} downloads cancelados`],
    [/^(\d+) downloads? requeued$/, (m) => `${m[1]} downloads reenfileirados`],
    [/^(\d+) failed entries cleared$/, (m) => `${m[1]} falhas descartadas`],
    [/^None of these are in your library\.$/, () => 'Nenhuma destas está na sua biblioteca.'],
    [/^(\d+) found in the catalogue for “(.+)”\.$/, (m) => `${m[1]} encontradas no catálogo para “${m[2]}”.`],
    [/^(\d+) found in the catalogue\.$/, (m) => `${m[1]} encontradas no catálogo.`],
    [/^Confirm and I will fetch them\.$/, () => 'Confirme e eu baixo.'],
    [/^None of these are in your library\. (\d+) found in the catalogue for “(.+)”\. Confirm and I will fetch them\.$/,
      (m) => `Nenhuma destas está na sua biblioteca. ${m[1]} encontradas no catálogo para “${m[2]}”. Confirme e eu baixo.`],
    [/^None of these are in your library\. (\d+) found in the catalogue\. Confirm and I will fetch them\.$/,
      (m) => `Nenhuma destas está na sua biblioteca. ${m[1]} encontradas no catálogo. Confirme e eu baixo.`],
    [/^(\d+) tracks? outside your library match that\. Nothing is downloaded until you say so\.$/,
      (m) => `${m[1]} faixas fora da sua biblioteca correspondem. Nada é baixado até você confirmar.`],
    [/^(\d+) tracks? match (.+), (\d+) with audio\.$/, (m) => `${m[1]} faixas correspondem a ${m[2]}, ${m[3]} com áudio.`],
    [/^Queueing "(.+)" by (.+), (\d+) tracks?\.$/, (m) => `Enfileirando “${m[1]}” de ${m[2]}, ${m[3]} faixas.`],
    [/^Queueing (\d+) tracks? from the catalogue\.$/, (m) => `Enfileirando ${m[1]} faixas do catálogo.`],
    [/^Queueing (\d+) tracks? from "(.+)"\.$/, (m) => `Enfileirando ${m[1]} faixas de “${m[2]}”.`],
    [/^Queued (\d+) tracks? from outside your library\.$/, (m) => `${m[1]} faixas de fora da sua biblioteca na fila.`],
    [/^Created "(.+)" with (\d+) tracks?, (\d+) downloading\.$/, (m) => `Criei “${m[1]}” com ${m[2]} faixas, ${m[3]} baixando.`],
    [/^Created "(.+)" with (\d+) tracks?\.$/, (m) => `Criei “${m[1]}” com ${m[2]} faixas.`],
    [/^Nothing to do\.$/, () => 'Nada a fazer.'],
    [/^\+(\d+) more$/, (m) => `+${m[1]} mais`],
    [/^Create \+ download (\d+)$/, (m) => `Criar + baixar ${m[1]}`],
    [/^Download (\d+)$/, (m) => `Baixar ${m[1]}`],
    [/^(\d+) downloads queued in the background$/, (m) => `${m[1]} downloads na fila em segundo plano`],

    [/^Found in the catalogue for “(.+)”\.$/, (m) => `Encontrada no catálogo para “${m[1]}”.`],
    // A&R result fragments (agent.js composes these)
    [/^(\d+) of (\d+) you already play\.$/, (m) => `${m[1]} de ${m[2]} você já toca.`],
    [/^(\d+) new from artists around your rotation\.$/, (m) => `${m[1]} novas de artistas da sua rotação.`],
    [/^(\d+) new from “(.+)”\.$/, (m) => `${m[1]} novas de “${m[2]}”.`],
    [/^(\d+) new from the catalogue\.$/, (m) => `${m[1]} novas do catálogo.`],
    [/^Nothing new turned up this time\.$/, () => 'Nada novo apareceu desta vez.'],
    [/^All from your library\.$/, () => 'Tudo da sua biblioteca.'],
    [/^For a brief: (.+)\.$/, (m) => `Para um briefing: ${m[1]}.`],
    [/^(\d+) in your library, (\d+) new\.$/, (m) => `${m[1]} na sua biblioteca, ${m[2]} novas.`],
    [/^(\d+) from your library - it has no explicit flag, so check these before playing them to a child\.$/,
      (m) => `${m[1]} da sua biblioteca - ela não tem marcação de conteúdo explícito, então confira antes de tocar para uma criança.`],
    [/^(\d+) clean catalogue tracks; nothing from your library, which has no explicit flag\.$/,
      (m) => `${m[1]} faixas limpas do catálogo; nada da sua biblioteca, que não tem marcação de conteúdo explícito.`],
    [/^The catalogue did not answer just now, so this is your library only\.$/,
      () => 'O catálogo não respondeu agora, então isto é só a sua biblioteca.'],
    [/^Nothing by “(.+)” is in your library, and the catalogue returned no match for that name\.$/,
      (m) => `Nada de “${m[1]}” está na sua biblioteca, e o catálogo não achou esse nome.`],
    [/^(\d+) by “(.+)” in your library, nothing new found\.$/, (m) => `${m[1]} de “${m[2]}” na sua biblioteca, nada novo encontrado.`],
    [/^(\d+) by “(.+)” in your library, (\d+) new from the catalogue\.$/, (m) => `${m[1]} de “${m[2]}” na sua biblioteca, ${m[3]} novas do catálogo.`],
    [/^(.+): under (\d+) BPM\.$/, (m) => `${m[1]}: abaixo de ${m[2]} BPM.`],
    [/^(.+) - choose a cover$/, (m) => `${m[1]} - escolha uma capa`],
    [/^Version (.+) is available\.$/, (m) => `A versão ${m[1]} está disponível.`],
    [/^Play (\d+)$/, (m) => `Tocar ${m[1]}`],
    // aria-labels: "Play <track>" is 60+ labels on a library page
    [/^Play (.+)$/, (m) => `Reproduzir ${m[1]}`],
    [/^BUILT FROM (.+)$/, (m) => `FEITO A PARTIR DE ${m[1]}`],
    [/^Delete "(.+)"\? The audio file is removed from disk and the track disappears from every playlist\.$/,
      (m) => `Excluir “${m[1]}”? O arquivo de áudio é apagado do disco e a faixa sai de todas as listas.`],
    [/^Delete "(.+)" from the library\?$/, (m) => `Excluir “${m[1]}” da biblioteca?`],
    [/^Delete this track\? The audio file is removed from disk and it disappears from every playlist\.$/,
      () => 'Excluir esta faixa? O arquivo de áudio é apagado do disco e ela sai de todas as listas.'],
    [/^Delete this track from the library\?$/, () => 'Excluir esta faixa da biblioteca?'],
    [/^Delete (\d+) tracks\? (\d+) audio files are removed from disk and they disappear from every playlist\.$/,
      (m) => `Excluir ${m[1]} faixas? ${m[2]} arquivos de áudio são apagados do disco e elas saem de todas as listas.`],
    [/^Delete (\d+) tracks\? and they disappear from every playlist\.$/,
      (m) => `Excluir ${m[1]} faixas? Elas saem de todas as listas.`],
    [/^Delete the album "(.+)"\? (\d+) tracks will be removed from the library and from every playlist, and (\d+) audio files will be deleted from disk\. This cannot be undone\.$/,
      (m) => `Excluir o álbum “${m[1]}”? ${m[2]} faixas saem da biblioteca e de todas as listas, e ${m[3]} arquivos de áudio são apagados do disco. Isso não pode ser desfeito.`],

    [/^Queue (\d+)$/, (m) => `Fila ${m[1]}`],
    [/^Queued (\d+)$/, (m) => `${m[1]} na fila`],

    [/^Version (.+) is installed\. Restart to run it\.$/, (m) => `A versão ${m[1]} está instalada. Reinicie para executá-la.`],

    [/^Updated to (.+)\. Restarting…$/, (m) => `Atualizado para ${m[1]}. Reiniciando…`],
    [/^Updated to (.+)\. Restart with: (.+)$/, (m) => `Atualizado para ${m[1]}. Reinicie com: ${m[2]}`],
    [/^Updated\. Restart with: (.+)$/, (m) => `Atualizado. Reinicie com: ${m[1]}`],

    [/^Cover of “(.+)” goes to$/, (m) => `A capa de “${m[1]}” vai para`],
    [/^Add "(.+)" to$/, (m) => `Adicionar “${m[1]}” a`],


    // the menu label carries an arrow or a plus before the words
    [/^\u2192 Play next$/, () => '→ Tocar em seguida'],
    [/^\+ Add to queue$/, () => '+ Adicionar à fila'],

    [/^Add (\d+) to playlist$/, (m) => `Adicionar ${m[1]} à lista`],
    [/^Delete (\d+) selected$/, (m) => `Excluir ${m[1]} selecionadas`],
    [/^Delete playlist "(.+)"\? Tracks stay in your library\.$/, (m) => `Excluir a lista “${m[1]}”? As faixas continuam na sua biblioteca.`],
    [/^Analyze (\d+) tracks?\? This runs on the Pi and takes a while\.$/, (m) => `Analisar ${m[1]} faixas? Isso roda nesta máquina e leva um tempo.`],
    [/^Analyze (\d+) tracks?\? This runs on this machine and takes a while\.$/, (m) => `Analisar ${m[1]} faixas? Isso roda nesta máquina e leva um tempo.`],
    [/^(\d+) files? are in a format rekordbox and Traktor cannot open\. Convert them to m4a now\? The originals are replaced\.$/,
      (m) => `${m[1]} arquivos estão num formato que o rekordbox e o Traktor não abrem. Converter para m4a agora? Os originais são substituídos.`],



    [/^No answer: (.+)$/, (m) => `Sem resposta: ${String(m[1]).replace(/^model endpoint\b/, 'endpoint do modelo').replace('empty response', 'resposta vazia')}`],
    [/^(\d+) tracks$/, (m) => `${m[1]} ${m[1] === '1' ? 'faixa' : 'faixas'}`],
    [/^(\d+) track$/, (m) => `${m[1]} faixa`],
    [/^Downloading: (.+)$/, (m) => `Baixando: ${m[1]}`],
    [/^Import failed: (.+)$/, (m) => `Falha na importação: ${m[1]}`],
    [/^Import failed:$/, () => 'Falha na importação:'],
    [/^(\d+) tracks? match (.+)\.$/, (m) => `${m[1]} faixas correspondem a ${m[2]}.`],
    [/^(\d+) of (\d+) tracks have audio\. Families: (.+)\.$/, (m) => `${m[1]} de ${m[2]} faixas têm áudio. Famílias: ${m[3]}.`],
    [/^(\d+) tracks outside your library match that\. Nothing is downloaded until you say so\.$/, (m) => `${m[1]} faixas fora da sua biblioteca correspondem. Nada é baixado até você confirmar.`],
    [/^(\d+) tracks in your library, (\d+) in the catalogue\.$/, (m) => `${m[1]} faixas na sua biblioteca, ${m[2]} no catálogo.`],
    [/^None of these are in your library\.$/, () => 'Nenhuma destas está na sua biblioteca.'],
    [/^I could not find that album in the catalogue\.$/, () => 'Não encontrei esse álbum no catálogo.'],
    [/^Queueing (.+)$/, (m) => `Enfileirando ${m[1]}`],
    [/^Queued (\d+) downloads?\.$/, (m) => `${m[1]} downloads na fila.`],
    [/^Downloaded: (.+)$/, (m) => `Baixado: ${m[1]}`],
    [/^Download failed: (.+)$/, (m) => `Falha no download: ${m[1]}`],
    [/^Added to (.+)$/, (m) => `Adicionada a ${m[1]}`],
    [/^(\d+) tracks? added$/, (m) => `${m[1]} faixas adicionadas`],
    [/^(\d+) queued$/, (m) => `${m[1]} na fila`],
    [/^(\d+) downloads queued$/, (m) => `${m[1]} downloads na fila`],
    [/^(\d+) downloads cancelled$/, (m) => `${m[1]} downloads cancelados`],
    [/^(\d+) tracks? updated$/, (m) => `${m[1]} faixas atualizadas`],
    [/^Cover set on (\d+) tracks?$/, (m) => `Capa definida em ${m[1]} faixas`],
    [/^Tagged (\d+) files$/, (m) => `${m[1]} arquivos marcados`],
    [/^Fixed (\d+) fields$/, (m) => `${m[1]} campos corrigidos`],
    [/^Uploading (\d+) of (\d+): (.+)$/, (m) => `Subindo ${m[1]} de ${m[2]}: ${m[3]}`],
    [/^(\d+)°C, (clear|cloudy|foggy|rainy|snowy|showery|stormy) in (.+)\.$/, (m) => `${m[1]}°C, ${({clear:'limpo',cloudy:'nublado',foggy:'com neblina',rainy:'chuvoso',snowy:'com neve',showery:'com pancadas',stormy:'com tempestade'})[m[2]]} em ${m[3]}.`],
    [/^(\d+)°C, (clear|cloudy|foggy|rainy|snowy|showery|stormy)\.$/, (m) => `${m[1]}°C, ${({clear:'limpo',cloudy:'nublado',foggy:'com neblina',rainy:'chuvoso',snowy:'com neve',showery:'com pancadas',stormy:'com tempestade'})[m[2]]}.`],
    [/^“(.+)”, (\d+) times this week\.$/, (m) => `“${m[1]}”, ${m[2]} vezes esta semana.`],
    [/^(.+), (\d+) plays this week\.$/, (m) => `${m[1]}, ${m[2]} reproduções esta semana.`],
    [/^At this hour you usually reach for (.+)\.$/, (m) => `Nesta hora você costuma ouvir ${m[1]}.`],
    [/^“(.+)” hasn't been on in (\d+) days\.$/, (m) => `“${m[1]}” não toca há ${m[2]} dias.`],
    [/^(\d+) BPM, more or less all week\.$/, (m) => `${m[1]} BPM, mais ou menos a semana toda.`],
    [/^(\d{2}:\d{2}) is your hour\.$/, (m) => `${m[1]} é a sua hora.`],
    [/^Você parou em (.+) at (\d{1,2}:\d{2})\.$/, (m) => `Você parou em ${m[1]} às ${m[2]}.`],
    [/^(\d+) new tracks? this week(?:; (\d+) still unheard)?\.$/, (m) => `${m[1]} ${m[1] === '1' ? 'faixa nova' : 'faixas novas'} esta semana${m[2] ? `; ${m[2]} ainda não ouvida${m[2] === '1' ? '' : 's'}` : ''}.`],
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
    [/^Analyse ([\d.,]+) never analysed$/, (m) => `Analisar ${m[1]} nunca analisadas`],
    [/^Analyze ([\d.,]+) never analysed$/, (m) => `Analisar ${m[1]} nunca analisadas`],
    [/^Prep (\d+)$/, (m) => `Preparar ${m[1]}`],
    [/^Update (\d+)$/, (m) => `Atualizar ${m[1]}`],
    [/^(\d+)\/(\d+) up to date$/, (m) => `${m[1]}/${m[2]} em dia`],
    [/^(\d+) without cue points$/, (m) => `${m[1]} sem cue points`],
    [/^(\d+) need cue points$/, (m) => `${m[1]} precisam de cue points`],
    [/^([\d.,]+) never analysed$/, (m) => `${m[1]} nunca analisadas`],
    [/^(\d+) never$/, (m) => `${m[1]} nunca`],
    [/^(\d+)\/(\d+) audio$/, (m) => `${m[1]}/${m[2]} áudio`],
    [/^Done ([\d,]+)$/, (m) => `Concluído ${m[1]}`],
    [/^Prepping ([\d,]+)\/([\d,]+)$/, (m) => `Preparando ${m[1]}/${m[2]}`],
    [/^Re-analysing ([\d,]+)\/([\d,]+)$/, (m) => `Analisando novamente ${m[1]}/${m[2]}`],
    [/^Make (\d+) playable$/, (m) => `Tornar ${m[1]} reproduzíveis`],
  ];

  // generic word rules run only after every specific sentence rule has had a chance.
  // Otherwise "10 tracks by X I don't have" becomes half English before its own rule.
  const wordPatterns = [
    [/\b(\d+) tracks\b/g, (m) => `${m[1]} ${m[1] === '1' ? 'faixa' : 'faixas'}`],
    [/\b(\d+) track\b/g, (m) => `${m[1]} faixa`],
    [/\b(\d+) songs\b/g, (m) => `${m[1]} ${m[1] === '1' ? 'música' : 'músicas'}`],
    [/\b(\d+) playlists\b/g, (m) => `${m[1]} ${m[1] === '1' ? 'lista' : 'listas'}`],
    [/\bwithout cue points\b/g, () => 'sem cue points'],
    [/\bup to date\b/g, () => 'em dia'],
    [/\bnever analysed\b/g, () => 'nunca analisadas'],
    [/\bnot downloaded\b/g, () => 'não baixadas'],
    [/\bANALYSED\b/g, () => 'ANALISADAS'],
    [/\b(\d+) need analysis\b/g, (m) => `${m[1]} ${m[1] === '1' ? 'precisa' : 'precisam'} de análise`],
    [/\banalysed, current\b/g, () => 'analisadas, em dia'],
    [/\blistening only\b/g, () => 'somente audição'],
    [/\blistening\b/g, () => 'em audição'],
  ];

  const SKIP = [
    '.tt', '.ta', '.tartist', '.talbum', '.talbum-line', '.tcard-name', '.tcard-sub',
    '.pcard-name', '.plhead-name', '.np-title', '.np-artist', '.np-album',
    '.crate-name', '.lrow-t b', '.crate-row-t b', '.mpick-t b', '.mast-name',
    '.album-chip b', '.q-title', '.q-sub', '.avoid-term',
    '.pb-title', '.pb-artist', '.mini-title', '.mini-artist', '.ctx-name', '#view-title', '.slib-name',
    '.apr-title', '.apr-artist', '.ap-title', '.ap-artist', '.np-ctx', '.mast-name',
    '.genrechip', '.keychip', '.tno', '.tdur', '.tbpm', '.trbadge', '.tadded',
    'script', 'style', 'textarea',
  ].join(',');

  function isUserContent(node) {
    const el = node.parentElement;
    if (node.nodeValue && node.nodeValue.trim() === 'Liked Songs') return false;
    return !el || !!el.closest(SKIP);
  }

  // one string against the dictionary and the rules; used both whole and per sentence
  function translateKey(key) {
    const hit = pt[key];
    if (hit) return { out: hit, changed: true };
    let out = key;
    let changed = false;
    for (const [re, fn] of patterns) {
      re.lastIndex = 0;
      if (!re.test(out)) continue;
      re.lastIndex = 0;
      out = out.replace(re, (...args) => fn(args));
      changed = true;
    }
    for (const [re, fn] of wordPatterns) {
      re.lastIndex = 0;
      if (!re.test(out)) continue;
      re.lastIndex = 0;
      out = out.replace(re, (...args) => fn(args));
      changed = true;
    }
    return { out, changed };
  }

  function translateString(value) {
    if (lang !== 'pt-BR' || !value) return value;
    const key = value.trim();
    if (!key) return value;
    const whole = translateKey(key);
    if (whole.changed) return value.replace(key, whole.out);
    // the server composes some answers from several sentences ("Downtempo: under 115
    // BPM. 4 of 5 you already play. Nothing new turned up."). Each sentence has a rule,
    // the whole does not, so try them one by one before giving up.
    const parts = key.split(/(?<=[.!?])\s+/);
    if (parts.length > 1) {
      let any = false;
      const joined = parts.map((part) => {
        const r = translateKey(part);
        if (r.changed) any = true;
        return r.out;
      }).join(' ');
      if (any) return value.replace(key, joined);
    }
    return value;
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
    // a text node inserted on its own (the clock, a view title) is not walked, so the
    // skip list has to be checked here too or user data gets translated
    if (root.nodeType === 3) return isUserContent(root) ? undefined : translateNode(root);
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
        else if (m.type === 'characterData') {
          if (!isUserContent(m.target)) translateNode(m.target);
        }
      }
    });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  window.I18N = { lang, supported, set, translate, t: (s) => translateString(s) };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
