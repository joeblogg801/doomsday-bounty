import assert from "assert";
import { hexlify, solidityPack } from "ethers/lib/utils";

export interface IBunker {
  tokenId: number;
  owner: string;
  x: bigint;
  y: bigint;
  reinforcement: number;
  damage: number;
  lastImpact: string;
}

interface IImpact {
  x: bigint;
  y: bigint;
  radius: bigint;
  impactId: string;
}

const MAP_WIDTH = 4320000n; // map units
const MAP_HEIGHT = 2588795n; // map units
const BASE_BLAST_RADIUS = 100000n; // map units

const enum Stage {
  Apocalypse = 2,
  PostApocalypse,
}

const MAX_INT = 2n ** 255n - 1n;

export class Doomsday {
  // eslint-disable-next-line no-useless-constructor
  constructor(
    public readonly state: Map<number, IBunker>,
    private hash: bigint
  ) {}

  clone(): Doomsday {
    const newState = new Map<number, IBunker>();
    for (const [tokenId, bunker] of this.state) {
      newState.set(tokenId, { ...bunker });
    }
    return new Doomsday(newState, this.hash);
  }

  stage() {
    return this.state.size > 1 ? Stage.Apocalypse : Stage.PostApocalypse;
  }

  private static encodeImpact(_impact: string): string {
    // return _impact;
    const v = BigInt(_impact) % (2n ** 240n - 1n);
    return hexlify(v);
  }

  setBlockhash(hash: bigint) {
    this.hash = hash;
  }

  totalSupply() {
    return BigInt(this.state.size);
  }

  currentImpact(): IImpact {
    const hash = this.hash % MAX_INT;
    // Min radius is half map height divided by num
    let o = MAP_HEIGHT / 2n / (this.totalSupply() + 1n);

    // Limited in smallness to about 8% of map height
    if (o < BASE_BLAST_RADIUS) {
      o = BASE_BLAST_RADIUS;
    }
    // Max radius is twice this
    const x = (hash % MAP_WIDTH) - MAP_WIDTH / 2n;
    const y = ((hash / MAP_WIDTH) % MAP_HEIGHT) - MAP_HEIGHT / 2n;
    const radius = ((hash / MAP_WIDTH / MAP_HEIGHT) % o) + o;

    const impactId = solidityPack(["int64[]", "int64"], [[x, y], radius]);
    // const impactId = `${x}|${y}|${radius}`;
    return { x, y, radius, impactId };
  }

  confirmHit(_tokenId: number) {
    assert(this.stage() === Stage.Apocalypse, "stage");
    assert(this.isValidToken(_tokenId), "invalid");

    const { reinforcement, damage, lastImpact } = this.state.get(_tokenId)!;

    //  covered by isValidToken
    //      require(_damage <= _reinforcement,"eliminated" );

    assert(this.checkVulnerable(_tokenId, lastImpact), "vulnerable");

    const impactId = Doomsday.encodeImpact(this.currentImpact().impactId);

    if (damage < reinforcement) {
      this.setStructuralData(_tokenId, reinforcement, damage + 1, impactId);
    } else {
      this.deleteToken(_tokenId);
    }
  }

  evacuate(_tokenId: number) {
    assert(this.stage() === Stage.Apocalypse, "stage");
    assert(!this.isVulnerable(_tokenId), "vulnerable");
    this.deleteToken(_tokenId);
  }

  setStructuralData(
    _tokenId: number,
    reinforcement: number,
    damage: number,
    lastImpact: string
  ) {
    const bunker = this.state.get(_tokenId);
    assert(bunker);
    bunker.reinforcement = reinforcement;
    bunker.damage = damage;
    bunker.lastImpact = Doomsday.encodeImpact(lastImpact);
  }

  private deleteToken(tokenId: number) {
    this.state.delete(tokenId);
  }

  static distanceSquared(
    x1: bigint,
    y1: bigint,
    x2: bigint,
    y2: bigint
  ): bigint {
    const dx = x1 - x2;
    const dy = y1 - y2;
    return min3(
      dx ** 2n + dy ** 2n,
      (dx + MAP_WIDTH) ** 2n + dy ** 2n,
      (dx - MAP_WIDTH) ** 2n + dy ** 2n
    );
  }

  checkVulnerable(_tokenId: number, _lastImpact: string): boolean {
    const { x, y, radius, impactId } = this.currentImpact();

    if (_lastImpact === Doomsday.encodeImpact(impactId)) return false;

    const bunker = this.state.get(_tokenId);
    assert(bunker);

    const dx = bunker.x - x;
    const dy = bunker.y - y;

    return (
      dx ** 2n + dy ** 2n < radius ** 2n ||
      (dx + MAP_WIDTH) ** 2n + dy ** 2n < radius ** 2n ||
      (dx - MAP_WIDTH) ** 2n + dy ** 2n < radius ** 2n
    );
  }

  isVulnerable(_tokenId: number) {
    const bunker = this.state.get(_tokenId);
    assert(bunker);
    return this.checkVulnerable(_tokenId, bunker.lastImpact);
  }

  isValidToken(_tokenId: number) {
    return this.state.has(_tokenId);
  }

  allVulnerable(): number[] {
    if (this.stage() === Stage.PostApocalypse) return [];
    const result: number[] = [];
    for (const [tokenId] of this.state) {
      if (this.isVulnerable(tokenId)) {
        result.push(tokenId);
      }
    }
    return result;
  }

  winner(): IBunker & { tokenId: number } {
    assert(this.state.size === 1);
    for (const [tokenId, bunker] of this.state) {
      return { ...bunker, tokenId };
    }
    assert(false);
  }
}

function min2(a: bigint, b: bigint) {
  return a < b ? a : b;
}

function min3(a: bigint, b: bigint, c: bigint) {
  return min2(min2(a, b), c);
}

export function findFarthest(
  game: Doomsday,
  impact: IImpact,
  include: (tokenId: number, bunker: IBunker) => boolean
): number {
  let bestDistance = 0n;
  let bestTokenId = -1;
  for (const [tokenId, bunker] of game.state) {
    if (include(tokenId, bunker)) {
      const distance = Doomsday.distanceSquared(
        bunker.x,
        bunker.y,
        impact.x,
        impact.y
      );
      if (bestTokenId === -1 || distance > bestDistance) {
        bestDistance = distance;
        bestTokenId = tokenId;
      }
    }
  }
  return bestTokenId;
}

export function findClosest(
  game: Doomsday,
  impact: IImpact,
  include: (tokenId: number, bunker: IBunker) => boolean
): number {
  let bestDistance = 0n;
  let bestTokenId = -1;
  for (const [tokenId, bunker] of game.state) {
    if (include(tokenId, bunker)) {
      const distance = Doomsday.distanceSquared(
        bunker.x,
        bunker.y,
        impact.x,
        impact.y
      );
      if (bestTokenId === -1 || distance < bestDistance) {
        bestDistance = distance;
        bestTokenId = tokenId;
      }
    }
  }
  return bestTokenId;
}

export function findWinningStrategy(
  game: Doomsday,
  DAO: string
): { move: "hit" | "evacuate" | "transfer"; tokenId: number }[] {
  game = game.clone();
  assert(game.stage() !== Stage.PostApocalypse);
  const winningTokenId = findFarthest(
    game,
    game.currentImpact(),
    (tokenId, bunker) => bunker.owner === DAO
  );
  const bunker = game.state.get(winningTokenId);
  assert(bunker);
  assert(bunker.owner === DAO);
  let winningTokenTransfered = false;
  const result: {
    move: "hit" | "evacuate" | "transfer";
    tokenId: number;
  }[] = [];
  let ownedByDAO = 0;
  for (const [, bunker] of game.state) {
    if (bunker.owner === DAO) {
      ownedByDAO += 1;
    }
  }
  for (;;) {
    if (ownedByDAO === 0) return [];
    if (game.stage() === Stage.PostApocalypse) {
      return winningTokenTransfered ? result : [];
    }
    if (!winningTokenTransfered && !game.isVulnerable(winningTokenId)) {
      winningTokenTransfered = true;
      result.push({ move: "transfer", tokenId: winningTokenId });
    }
    // hit all that will not be destroyed
    const impact = game.currentImpact();
    const consider = new Set<number>();
    for (const [tokenId, bunker] of game.state) {
      if (bunker.owner !== DAO && game.isVulnerable(tokenId)) {
        if (bunker.reinforcement > bunker.damage) {
          result.push({ move: "hit", tokenId: tokenId });
          game.confirmHit(tokenId);
        } else {
          consider.add(tokenId);
        }
      }
    }
    const bestDestroyId = findFarthest(game, impact, (tokenId) =>
      consider.has(tokenId)
    );
    // hit farthest from epicenter
    if (bestDestroyId > -1) {
      result.push({ move: "hit", tokenId: bestDestroyId });
      game.confirmHit(bestDestroyId);
      continue;
    }
    // evacuate DAO
    let evacuated = false;
    for (const [tokenId, bunker] of game.state) {
      if (bunker.owner === DAO && bunker.tokenId !== winningTokenId) {
        if (game.isVulnerable(tokenId)) {
          if (bunker.reinforcement > bunker.damage) {
            result.push({ move: "hit", tokenId: tokenId });
            game.confirmHit(tokenId);
            result.push({ move: "evacuate", tokenId: tokenId });
            game.evacuate(tokenId);
          } else {
            result.push({ move: "hit", tokenId: tokenId });
            game.confirmHit(tokenId);
          }
        } else {
          result.push({ move: "evacuate", tokenId: tokenId });
          game.evacuate(tokenId);
        }
        evacuated = true;
        if (!winningTokenTransfered && !game.isVulnerable(winningTokenId)) {
          winningTokenTransfered = true;
          result.push({ move: "transfer", tokenId: winningTokenId });
        }
        break;
      }
    }
    if (!evacuated) return [];
    ownedByDAO -= 1;
  }
}
