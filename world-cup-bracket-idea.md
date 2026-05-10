# World Cup Bracket

## Description
A webapp to allow friends and family to compete on predicting the results of the FIFA 2026 World Cup. Each user can predict a match’s score (e.g: 3-2) and outcome (e.g: Argentina wins). Each successful prediction wins them points: 3 points for a successful score prediction, and 1 point for a successful outcome prediction. Users can also predict the overall results of the World Cup: Champion, Second and Third Place. The user with the most points by the end of the World Cup wins a prize.

## Fifa World Cup overview
- The 2026 FIFA World Cup is being played across the US, Canada, and Mexico. There will be 104 games total.
- For the Group stage: Teams are organized in 12 groups of 4, labeled from A-L. Each team plays all other teams in their groups once (3 matches). Teams win 3 points for a win, and 1 point for a draw. The top 2 ranked teams per group qualify to the Round of 32. The top 8 teams in 3rd place across all groups also qualify. In total, the Group stage covers 3 Rounds, each one with 24 games (2 games per group).
- Starting with the Round of 32, all matches are elimination matches. Whoever wins advances. Teams are grouped into brackets with teams from other groups and must win to advance.
- There’s one additional match played for the Third Place between the losers of the semi-finals.
- For more details: do some research on the Fifa.com site.

## Bracket mechanics
- Users will predict the score and outcome of each match in a given Round. A Round is a series of games where the user can predict the scores and outcomes.
  - For the Group Stage: a Round represents 1 full set of games for every Group (meaning all teams in all groups play at least 1 game). Since the Group Stage has 12 Groups with 4 teams, there will be 3 Rounds during the Group Stage.
  - Starting with the Round of 32 all rounds are Knockout Rounds. Users will be able to predict the full set of games for the next Knockout Round before it starts. For example: users will be able to predict the full set of Round of 32 games.
  - Given there are 6 Knockout rounds (Round of 32, 16, Quarterfinals, Semifinals, Finals and Third place match) + 3 Group Stage rounds, users will have 9 opportunities to place their predictions.
- Users cannot place predictions after a Round has started.
- Users can place predictions before a Round has started and edit them up until a deadline (let’s say, 4 hours before the first match in a Round starts). This applies even to future Rounds: for example, a user can place predictions for all rounds from the very beginning of the Cup if they want. But the ability to edit these predictions will end subsequently as each Round starts.
- For each match in a round, a user can predict the following:
  - Score: predict the results of the match for each team in the match (e.g: Argentina 3 - Brazil 2).
  - Outcome: predict the overall outcome of the match (e.g: Argentina wins). Valid options are: Team X wins, or Tie.
  - Predictions during Knockout Rounds: During Knockout Rounds there can be NO ties. All games are extended to Extra Time (additional 30 mins) or Penalty Shootouts. For Knockout Rounds, predictions will work this way:
    - Score predictions apply to the final score of a match up to the 120th minute and BEFORE penalty shootouts. So users can still predict a tied score (e.g: 2-2).
    - Outcome predictions CANNOT include ties, since all ties are resolved in the end via penalty shootouts. So a user MUST predict the winning team for all Knockout Stage matches.
- Prediction points:
  - Each successful score prediction is worth 3 points.
  - Each successful outcome prediction is worth 1 point.
- Finalists predictions: Additionally, users can predict which teams will be 1st, 2nd and 3rd overall in the Cup. These predictions MUST be locked in before the World Cup starts.
  - A successful 1st place prediction is worth 5 points.
  - A successful 2nd place prediction is worth 3 points.
  - A successful 3rd place prediction is worth 1 point.
  - These predictions are IN ADDITION TO the normal points a user can win during match predictions.

## CUJs
1. As a user, I want to create an account.
- Users can create an account using Google SSO.
- Users can create and customize their profile with their username, profile picture, and the team they’re rooting for.

2. As a user, I want to create my bracket.
- Users can see all Rounds and Stages in the World Cup, including the respective time in which each Round closes.
- Users can add their predictions for each Match in a Round (must include scores and outcomes).
- Users can edit predictions for a given match AS LONG AS the Prediction deadline hasn’t ended.

3. As a user, I want to see a leaderboard.
- Users can see a live points scoreboard for all users with a profile in the app.

4. As a user, I want to be informed of upcoming Round deadlines.
- Users can receive an email letting them know of an upcoming deadline to edit their Round predictions.

## Feature Inventory
1. User profile
- Includes Google SSO
- Includes the ability to view a user’s profile, and edit your own profile. Users can add their username, profile picture and the team they’re rooting for.

2. World Cup Bracket
- The full set of Matches and Rounds in which users can participate to make their predictions.
- Matches and Rounds MUST be refreshed from live FIFA data to ensure the app shows updated information.

3. FIFA live data integration
- Pulls information on Match times, teams, and results.

4. Email integration
- Informs users of upcoming Prediction Deadlines using the email address they used to create their account.