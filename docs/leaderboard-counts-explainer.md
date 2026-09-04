# A note about the leaderboard stats

**Posted June 27, 2026**

Some of you noticed that the leaderboard was showing the wrong numbers next
to your name. You were right, and we're sorry for the confusion. Here's a
plain-English explanation of what happened, what we fixed, and how we'll keep
it from happening again.

## The short version

The little summary under each player — the **"X exact, Y outcome"** count —
was showing numbers that were too low for some people. **Your actual points
total and your ranking were always correct.** The bug was only in that
secondary breakdown, not in the score that decides who's winning.

It's fixed now. You don't need to do anything — just refresh the page.

## What actually went wrong

Think of the leaderboard as having two separate things on it:

1. **Your points total** — the big number that determines your rank.
2. **Your breakdown** — the "you nailed 8 exact scores and 36 outcomes" summary.

These two numbers are calculated in different ways behind the scenes.

Your **points total** is added up for each player individually. That part
worked perfectly the whole time.

Your **breakdown** was calculated by pulling the entire list of everyone's
scored predictions all at once and tallying them up. The problem: our database
has a built-in safety limit that only hands back the first **1,000** records
in a single request. Early in the tournament that was fine — there weren't
1,000 scored predictions yet. But as more matches were played, the total
crossed 1,000, and everything past that line simply got left out of the tally.

So some players had a few of their correct predictions quietly missing from
the **breakdown** count, even though those same predictions were fully counted
in their **points total**.

That's why the two numbers stopped agreeing — for example, a total of 60
points sitting next to a breakdown that only seemed to add up to 51. The
points total was the truthful one.

## What was and wasn't affected

**Not affected (always correct):**
- Your total points
- Your position on the leaderboard
- Every prediction you made and the points it earned

**Affected (now fixed):**
- The "exact / outcome" breakdown shown under each player — it was
  undercounting for anyone whose records fell past that 1,000 cutoff.

No points were lost, no predictions were missed in scoring, and no rankings
were ever wrong. We didn't have to "give back" or recalculate anyone's score,
because the scores were never the problem — only the display of the breakdown.

## The fix

We changed how the leaderboard gathers that breakdown. Instead of asking for
everything in one go and silently hitting the 1,000-record ceiling, it now
collects the records in batches and keeps going until it has every single one.
Nothing gets left behind, no matter how many predictions the tournament racks
up between now and the final.

The corrected counts are already live. The moment you reload the leaderboard,
the breakdown will match your points total.

## How we'll prevent it in the future

A few concrete steps:

- **We added an automated test** that recreates the exact situation that
  caused this — more than 1,000 records — and confirms the leaderboard counts
  every one of them. If anyone ever reintroduces this mistake, that test will
  catch it before it reaches you.

- **We're reviewing the rest of the app** for the same pattern, so no other
  screen can quietly run into the same hidden limit as the tournament grows.

- **We took the lesson to heart:** any time the app totals up data that grows
  with every match played, it has to be built to handle the full pile, not
  just the first slice of it.

## Thank you

Genuinely — thank you to everyone who flagged this. A few of you did the math
by hand, noticed your breakdown didn't add up to your total, and told us. That
is exactly how a bug like this gets caught quickly. We'd rather hear from you
than have something look off and go unmentioned.

If you spot anything else that doesn't look right, please keep telling us.

— The World Cup Bracket team
