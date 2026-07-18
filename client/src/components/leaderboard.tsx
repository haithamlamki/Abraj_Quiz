import { Trophy } from "lucide-react";
import { useTranslation } from "react-i18next";

interface Player {
  name: string;
  score: number;
}

interface LeaderboardProps {
  players: Player[];
  showPodium?: boolean;
  title?: string;
}

export default function Leaderboard({ players, showPodium = false, title }: LeaderboardProps) {
  const { t } = useTranslation();
  const resolvedTitle = title ?? t("results.leaderboard");
  const sortedPlayers = [...players].sort((a, b) => b.score - a.score);

  if (showPodium && sortedPlayers.length >= 3) {
    const [first, second, third, ...rest] = sortedPlayers;

    return (
      <div className="space-y-6">
        <h3 className="font-bold text-2xl text-gray-800 text-center">{resolvedTitle}</h3>

        {/* Podium Winners */}
        <div className="flex justify-center items-end space-x-4 rtl:space-x-reverse mb-8">
          {/* 2nd Place */}
          {second && (
            <div className="text-center">
              <div className="bg-gray-300 text-gray-700 w-16 h-16 rounded-full flex items-center justify-center font-bold text-xl mb-2">
                2
              </div>
              <div className="bg-gray-300 h-20 w-20 rounded-t-lg flex items-center justify-center px-2">
                <span className="font-bold text-gray-700 text-sm truncate">{second.name}</span>
              </div>
              <p className="text-sm text-gray-600 mt-2">{second.score.toLocaleString()} {t("common.pts")}</p>
            </div>
          )}
          
          {/* 1st Place */}
          {first && (
            <div className="text-center">
              <div className="bg-yellow-400 text-yellow-900 w-20 h-20 rounded-full flex items-center justify-center font-bold text-2xl mb-2 animate-bounce-gentle">
                <Trophy className="w-8 h-8" />
              </div>
              <div className="bg-yellow-400 h-32 w-24 rounded-t-lg flex items-center justify-center px-2">
                <span className="font-bold text-yellow-900 text-sm truncate">{first.name}</span>
              </div>
              <p className="text-sm text-gray-600 mt-2">{first.score.toLocaleString()} {t("common.pts")}</p>
            </div>
          )}
          
          {/* 3rd Place */}
          {third && (
            <div className="text-center">
              <div className="bg-orange-400 text-orange-900 w-16 h-16 rounded-full flex items-center justify-center font-bold text-xl mb-2">
                3
              </div>
              <div className="bg-orange-400 h-16 w-20 rounded-t-lg flex items-center justify-center px-2">
                <span className="font-bold text-orange-900 text-sm truncate">{third.name}</span>
              </div>
              <p className="text-sm text-gray-600 mt-2">{third.score.toLocaleString()} {t("common.pts")}</p>
            </div>
          )}
        </div>
        
        {/* Rest of the rankings */}
        {rest.length > 0 && (
          <div className="space-y-2">
            {rest.map((player, index) => (
              <div key={player.name} className="flex items-center justify-between bg-gray-50 rounded-lg p-3 hover:bg-gray-100 transition-colors">
                <div className="flex items-center space-x-3 rtl:space-x-reverse">
                  <span className="w-8 h-8 bg-primary text-primary-foreground rounded-full flex items-center justify-center font-bold text-sm">
                    {index + 4}
                  </span>
                  <span className="font-medium">{player.name}</span>
                </div>
                <span className="font-bold text-gray-700">{player.score.toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Regular leaderboard
  return (
    <>
      <h4 className="font-bold text-xl mb-4">{resolvedTitle}</h4>
      <div className="space-y-3">
        {sortedPlayers.map((player, index) => (
          <div key={player.name} className="flex items-center justify-between bg-white/10 rounded-lg p-3">
            <div className="flex items-center space-x-3 rtl:space-x-reverse">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                index === 0 ? 'abraj-green text-white' :
                index === 1 ? 'bg-gray-400 text-white' :
                index === 2 ? 'bg-orange-500 text-white' :
                'bg-primary text-primary-foreground'
              }`}>
                {index + 1}
              </div>
              <span className="font-medium text-[#0a0a0a]">{player.name}</span>
            </div>
            <span className={`font-bold ${
              index === 0 ? 'text-abraj-green' :
              index === 1 ? 'text-gray-300' :
              index === 2 ? 'text-orange-300' :
              'text-white'
            }`}>
              {player.score.toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
