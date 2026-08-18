-- Wann zuletzt für *diesen* Kandidaten gesucht wurde.
--
-- Der Suchlauf ist gemeinsam: fünf Pflegekräfte in derselben Stadt ergeben
-- eine Suche. „Vor einer Stunde gelaufen" sagt deshalb nichts darüber aus, ob
-- dabei auch nach dieser Kandidatin gesucht wurde — und genau das will wissen,
-- wer ihren Fall öffnet.
ALTER TABLE "CandidateCase" ADD COLUMN IF NOT EXISTS "lastSweptAt" TIMESTAMP(3);
