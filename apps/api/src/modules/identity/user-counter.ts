import type { Database } from '../../database/client';
import { UserRepository } from './user.repository';

/** What other modules may ask about a company's users (US-015 account summary). */
export class UserCounter {
  private readonly users: UserRepository;

  constructor(db: Database) {
    this.users = new UserRepository(db);
  }

  /** Users that count against the plan limit (O-26). */
  seats(companyId: string): Promise<number> {
    return this.users.countSeats(companyId);
  }
}
