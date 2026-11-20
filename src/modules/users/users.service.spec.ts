import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { User, UserStatus } from './entities/user.entity';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  const repo = {
    findOneBy: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: repo },
      ],
    }).compile();

    service = moduleRef.get(UsersService);
  });

  it('findByEmail looks the user up by the exact (already normalized) email', async () => {
    const user = { id: 'u1', email: 'a@example.com' } as User;
    repo.findOneBy.mockResolvedValue(user);

    await expect(service.findByEmail('a@example.com')).resolves.toBe(user);
    expect(repo.findOneBy).toHaveBeenCalledWith({ email: 'a@example.com' });
  });

  it('findByEmail returns null when there is no such user', async () => {
    repo.findOneBy.mockResolvedValue(null);

    await expect(service.findByEmail('nobody@example.com')).resolves.toBeNull();
  });

  it('create builds the entity and saves it', async () => {
    const data = {
      email: 'a@example.com',
      passwordHash: '$argon2id$...',
      status: UserStatus.Active,
    };
    const entity = { ...data } as User;
    const saved = { ...data, id: 'u1' } as User;
    repo.create.mockReturnValue(entity);
    repo.save.mockResolvedValue(saved);

    await expect(service.create(data)).resolves.toBe(saved);
    expect(repo.create).toHaveBeenCalledWith(data);
    expect(repo.save).toHaveBeenCalledWith(entity);
  });
});
