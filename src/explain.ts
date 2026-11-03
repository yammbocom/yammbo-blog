// Why / impact / what to do for the blog's Telegram alerts. Each entry is
// derived from where the matching error is thrown in index.ts; anything not
// matched says so instead of guessing.

export interface Why {
  why: string;
  action: string;
}

const LOG = 'Ver el error completo con `bash /root/repos/yammbo-loyverse-bridge/deploy.sh tail yammbo-blog` en el siguiente turno.';

const ERRORS: Array<[RegExp, Why]> = [
  [/User location is not supported/i, {
    why: 'Gemini rechazó la petición por la región desde la que salió el cron de Cloudflare. Pasa a ratos y no depende de nosotros.',
    action: 'Nada si el siguiente turno publica. Si se repite varios días, mover el cron a otra hora o pedir por otra ruta.',
  }],
  [/(Gemini|Image gen) HTTP 429/i, {
    why: 'Cuota o límite de velocidad de Gemini agotado (o la cuenta sin saldo).',
    action: 'Revisar cuota y facturación de la clave de Gemini en Google AI Studio.',
  }],
  [/(Gemini|Image gen) HTTP (401|403)/i, {
    why: 'Gemini no acepta la clave: caducada, revocada o sin permiso para ese modelo.',
    action: 'Comprobar la clave GEMINI_API_KEY del Worker y el modelo configurado.',
  }],
  [/(Gemini|Image gen) HTTP 404/i, {
    why: 'El modelo configurado ya no existe en Gemini (Google lo retiró o cambió de nombre).',
    action: 'Cambiar GEMINI_MODEL / el modelo de imagen en wrangler.toml y desplegar.',
  }],
  [/(Gemini|Image gen) HTTP 5\d\d/i, {
    why: 'Caída o saturación temporal de Gemini.',
    action: 'Nada si el siguiente turno publica.',
  }],
  [/Image gen no image/i, {
    why: 'El modelo de imagen respondió sin imagen (finish=OTHER suele ser su filtro o un fallo suyo a ratos).',
    action: 'Nada si el siguiente turno publica; si se repite, revisar el prompt de imagen del tema.',
  }],
  [/MAX_TOKENS|truncated/i, {
    why: 'Gemini cortó el artículo por el límite de longitud y el JSON quedó incompleto.',
    action: 'Subir maxOutputTokens en buildGeminiRequest y desplegar.',
  }],
  [/No JSON in Gemini output|Gemini response empty|Missing field/i, {
    why: 'Gemini contestó, pero no con el JSON del artículo que pide el prompt.',
    action: 'Mirar el finish= del error; si es SAFETY/RECITATION, el tema del feed no le gustó y basta con el siguiente turno.',
  }],
  [/\bGH [A-Z]+ \S+ -> (401|403)/, {
    why: 'GitHub no acepta el token del Worker (caducado o sin permiso de escritura en el repo del blog).',
    action: 'Renovar el token de GitHub del Worker.',
  }],
  [/\bGH [A-Z]+ \S+ -> (409|422)/, {
    why: 'GitHub rechazó el commit: alguien cambió el repo a la vez o el fichero ya existía.',
    action: 'Comprobar en el repo del blog si el post llegó; si no, el siguiente turno lo intenta.',
  }],
  [/\bGH [A-Z]+ \S+ -> |Bad JSON from GH/, {
    why: 'Fallo al hablar con la API de GitHub.',
    action: 'Comprobar githubstatus.com y el repo del blog.',
  }],
  [/vertical (config|in CFG)/i, {
    why: 'La configuración de temas (CFG) no tiene el tema que tocaba: error de configuración nuestro.',
    action: 'Revisar CFG en src/index.ts.',
  }],
];

export function explainError(msg: string): Why {
  for (const [re, w] of ERRORS) if (re.test(msg)) return w;
  return { why: 'Causa sin identificar (no coincide con ningún fallo conocido).', action: LOG };
}

const SKIPS: Record<string, string> = {
  no_items_after_parse: 'Los feeds del tema no devolvieron ninguna noticia legible (feed caído o cambiado de formato).',
  no_fresh_candidate: 'Todas las noticias de los feeds ya se habían usado: no había nada nuevo.',
  below_quality_threshold: 'Había noticias nuevas, pero ninguna pasó el mínimo de calidad.',
};

export function explainSkip(reason: string): string {
  return SKIPS[reason] || 'Motivo sin explicación registrada.';
}

export function skipAction(reason: string): string {
  return reason === 'no_items_after_parse'
    ? 'Abrir las URLs de los feeds del tema en CFG y ver cuál falla.'
    : 'Nada: el siguiente turno vuelve a mirar los feeds.';
}
