context {
    input phone: string;
    input forward: string?;
}

start node root
{
    do
    {
        #connectSafe($phone);
        #waitForSpeech(1000);
        #say("hello");
        wait *;
    }
    transitions
    {
        @exit: goto @exit on true;
    }
}

node @exit
{
    do
    {
        if ($forward is not null)
        {
            #say("forward");
            #forward($forward);
            exit;
        }
        #say("fine");
        exit;
    }
}