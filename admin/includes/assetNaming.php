<?php

// One place that turns a filename into a display name. Asset filenames use
// `_` between descriptor segments and `-` inside one ("bear_blue-heart_glitter"),
// but uploads are slugified to hyphens before they reach here, so both
// separators have to read the same way.
class AssetNaming
{
	public static function displayName($filename, $config, $fallback = '')
	{
		$base = pathinfo(str_replace('\\', '/', (string)$filename), PATHINFO_FILENAME);
		$tokens = self::tokenize($base, $config);
		if (!$tokens) {
			return $fallback;
		}
		// A trailing number is a variant marker, not part of the subject, so it
		// reads as a suffix rather than another word.
		$variant = null;
		if (count($tokens) > 1 && ctype_digit(end($tokens))) {
			$variant = ltrim(array_pop($tokens), '0');
			if ($variant === '') {
				$variant = '0';
			}
		}
		$words = [];
		foreach ($tokens as $index => $token) {
			$words[] = self::capitalize($token, $index === 0, $config);
		}
		$name = implode(' ', $words);

		return $variant === null ? $name : $name . ' (' . $variant . ')';
	}

	// The inverse of displayName, for deriving a file name from the display
	// name an editor typed. Spaces become `_` (the segment separator) and a
	// hyphen inside a segment survives, so "Bear Blue-heart Glitter" comes back
	// as bear_blue-heart_glitter. Token overrides are not reversed — they are
	// spelling repairs for filenames that never round-trip.
	public static function filename($displayName, $fallback = '')
	{
		$name = strtolower(trim((string)$displayName));
		$name = preg_replace('/\s+/', '_', $name);
		$name = preg_replace('/[^a-z0-9_-]+/', '', $name);
		$name = preg_replace('/-{2,}/', '-', $name);
		$name = preg_replace('/_{2,}/', '_', $name);
		$name = trim($name, '-_');

		return $name !== '' ? $name : $fallback;
	}

	private static function tokenize($base, $config)
	{
		// camelCase and letter/digit runs are word boundaries the separators
		// never marked: "FadetoPurple", "fran-black2".
		$spaced = preg_replace('/([a-z0-9])([A-Z])/', '$1 $2', (string)$base);
		$spaced = preg_replace('/([A-Z]{2,})([A-Z][a-z])/', '$1 $2', $spaced);
		$spaced = preg_replace('/([a-zA-Z])([0-9])/', '$1 $2', $spaced);
		$spaced = preg_replace('/([0-9])([a-zA-Z])/', '$1 $2', $spaced);
		$raw = preg_split('/[^a-zA-Z0-9]+/', $spaced, -1, PREG_SPLIT_NO_EMPTY);
		$tokens = [];
		foreach ($raw as $token) {
			$expansion = $config['name_token_overrides'][strtolower($token)] ?? null;
			if ($expansion === null) {
				$tokens[] = $token;
				continue;
			}
			foreach (explode(' ', $expansion) as $word) {
				$tokens[] = $word;
			}
		}

		return $tokens;
	}

	// An interior capital means the author cased the token deliberately — an
	// acronym or a brand prefix — so it survives verbatim. Everything else is
	// title cased, and minor words stay lowercase unless they lead the name.
	private static function capitalize($token, $leading, $config)
	{
		if (preg_match('/[A-Z]/', substr($token, 1))) {
			return $token;
		}
		$lower = strtolower($token);
		if (!$leading && in_array($lower, $config['name_minor_words'], true)) {
			return $lower;
		}

		return ucfirst($lower);
	}
}
