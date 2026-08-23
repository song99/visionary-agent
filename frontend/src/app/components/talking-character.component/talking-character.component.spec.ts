import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TalkingCharacterComponent } from './talking-character.component';

describe('TalkingCharacterComponent', () => {
  let component: TalkingCharacterComponent;
  let fixture: ComponentFixture<TalkingCharacterComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [TalkingCharacterComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(TalkingCharacterComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
